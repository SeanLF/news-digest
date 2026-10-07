// Replays one model stage of a stored run from the run's own artifacts, in a scratch copy of the
// product database (replay-provider.ts makes one per call), and returns what the stage produced with its cost.
// One attempt per activity, under production's start-to-close:
// a failure is a result to count, not something to retry away (a run's retries would hide a variant
// that fails one call in three), and the output says what a run would have done with it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attributeActivity } from "../activities/attribute.js";
import { clusterActivities, loadArticles } from "../activities/cluster.js";
import { coherenceActivity, draftFrom } from "../activities/coherence.js";
import { REQUIRED as SELECT_INPUTS, selectActivity } from "../activities/select.js";
import { CoherenceReportSchema } from "../contracts/coherence.js";
import { parseAgentSpec } from "../runner/prompt.js";
import { ArtifactStore, type Pointer } from "../store/artifacts.js";
import type { SdkQuery } from "../runner/run-stage.js";
import type { UsageRow } from "../store/usage.js";
import { MODEL_FANOUT_LIMIT, mapBounded } from "../workflow/bounded.js";
import { MODEL_MAX_ATTEMPTS } from "../workflow/policy.js";

export const MODES = ["cluster", "select", "coherence", "attribute"] as const;
export type Mode = (typeof MODES)[number];

const MIN = 60_000;
// Production's policy per stage: the workflow's proxies (model, verdict, attributing in
// digest.workflow.ts); stage-replay.test.ts holds this table to them.
export const PROD_POLICY: Record<Mode, { timeoutMs: number; perCall: boolean; onFailure: string }> = {
  cluster: { timeoutMs: 45 * MIN, perCall: true, onFailure: `each batch retried up to ${MODEL_MAX_ATTEMPTS} attempts (5, then 10 min apart), then lost: the join falls back to titles` },
  select: { timeoutMs: 45 * MIN, perCall: true, onFailure: `retried up to ${MODEL_MAX_ATTEMPTS} attempts (5, then 10 min apart), then the run parks for an operator` },
  coherence: { timeoutMs: 45 * MIN, perCall: true, onFailure: "one attempt: the run parks for an operator" },
  attribute: { timeoutMs: 10 * MIN, perCall: false, onFailure: "one attempt: the issue ships without attribution" },
};

export interface Usage { calls: number; costUsd: number; tokens: Record<string, number>; models: string[]; efforts: string[]; lostBatches: string[] }

async function drafts(store: ArtifactStore, run: number): Promise<Pointer[]> {
  const names = (await store.names(run)).filter((n) => /^draft_s\d+\.json$/.test(n)).toSorted();
  return Promise.all(names.map(async (n) => (await store.find(run, n))!));
}

async function need(store: ArtifactStore, run: number, name: string): Promise<Pointer> {
  const p = await store.find(run, name);
  if (!p) throw new Error(`run ${run} has no ${name}`);
  return p;
}

export interface Replayed { artifact: unknown; usage: Usage; failure?: { error: string; prodOnFailure: string } }

// `test` swaps in a fake model call and a shorter timeout; the command passes neither.
export async function replay(mode: Mode, store: ArtifactStore, run: number, agentsDir: string, test: { query?: SdkQuery; timeoutMs?: number } = {}): Promise<Replayed> {
  const usage: Usage = { calls: 0, costUsd: 0, tokens: {}, models: [], efforts: [], lostBatches: [] };
  const onUsage = (r: UsageRow) => {
    usage.calls++;
    usage.costUsd += r.costUsd;
    if (!usage.models.includes(r.model)) usage.models.push(r.model);
    if (!usage.efforts.includes(r.effort)) usage.efforts.push(r.effort);
    for (const [k, v] of Object.entries(r.tokens)) usage.tokens[k] = (usage.tokens[k] ?? 0) + v;
  };
  // One activity's budget: per model call where the activity is one call (or one batch), else one
  // signal for the whole activity, as attribute's 10 minutes cover all its per-story calls.
  const { perCall, onFailure } = PROD_POLICY[mode];
  const timeoutMs = test.timeoutMs ?? PROD_POLICY[mode].timeoutMs;
  const whole = perCall ? undefined : AbortSignal.timeout(timeoutMs);
  const deps = { store, agentsDir, onUsage, signal: () => whole ?? AbortSignal.timeout(timeoutMs), ...(test.query ? { query: test.query } : {}) };
  // Everything the stage reads is read and validated first, outside the try: the agent file as the plan
  // overrode it, the articles, drafts, report and repair. A missing or malformed input, database or run
  // is the harness's failure and fails the replay, never a variant's (a broken instrument must not read
  // as a result). What is left inside is the stage's own work; a database dropping mid-stage would still
  // count against it.
  const stage = await prepare(mode, deps, store, run, usage);
  let out: Pointer;
  try {
    out = await stage();
  } catch (e) {
    return { artifact: null, usage, failure: { error: String(e), prodOnFailure: onFailure } };
  }
  return { artifact: JSON.parse(await store.get(out)), usage };
}

type Deps = { store: ArtifactStore; agentsDir: string; onUsage: (r: UsageRow) => void; signal: () => AbortSignal; query?: SdkQuery };

const AGENT_FILE: Record<Mode, string> = { cluster: "cluster-extract.md", select: "select.md", coherence: "coherence.md", attribute: "attribute.md" };

async function prepare(mode: Mode, deps: Deps, store: ArtifactStore, run: number, usage: Usage): Promise<() => Promise<Pointer>> {
  parseAgentSpec(readFileSync(join(deps.agentsDir, AGENT_FILE[mode]), "utf8"));
  if ((await loadArticles(store, run)).length === 0) throw new Error(`run ${run} has no articles`);
  if (mode === "cluster") {
    const c = clusterActivities(deps);
    const { batches } = await c.planBatches(run);
    return async () => {
      // Bounded as in a run; a lost batch is part of the result, as in a run (joinClusters falls back to titles).
      const settled = await mapBounded(batches, MODEL_FANOUT_LIMIT, (b) => c.extractBatch(run, b, true));
      const tags = settled.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        usage.lostBatches.push(`b${batches[i]!.index}: ${String(r.reason)} (in a run: ${PROD_POLICY.cluster.onFailure})`);
        return null;
      });
      return c.joinClusters(run, tags, true);
    };
  }
  if (mode === "select") {
    for (const name of SELECT_INPUTS) await need(store, run, name);
    const [clusters, recap] = [await need(store, run, "clusters.json"), await need(store, run, "recap.txt")];
    JSON.parse(await store.get(clusters));
    return () => selectActivity(deps)(run, clusters, recap, undefined, { force: true });
  }
  const ds = await drafts(store, run);
  if (ds.length === 0) throw new Error(`run ${run} has no draft_sNN.json`);
  if (mode === "coherence") {
    const fulltext = await need(store, run, "article_fulltext.json");
    await draftFrom(store, ds);
    return () => coherenceActivity(deps)(run, ds, fulltext, undefined, true);
  }
  const [report, repair] = [await need(store, run, "coherence_report.json"), await need(store, run, "repair_resolution.json")];
  await draftFrom(store, ds);
  CoherenceReportSchema.parse(JSON.parse(await store.get(report)));
  JSON.parse(await store.get(repair));
  return () => attributeActivity(deps)(run, ds, report, repair, true);
}

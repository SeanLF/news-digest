// Replays one model stage of a stored run from the run's own artifacts, in a scratch copy of the
// product database (bin/replay makes one per replay), and writes what the stage produced with its cost.
// The command is src/cli/stage-replay.ts.
import { attributeActivity } from "../activities/attribute.js";
import { clusterActivities } from "../activities/cluster.js";
import { coherenceActivity } from "../activities/coherence.js";
import { selectActivity } from "../activities/select.js";
import { ArtifactStore, type Pointer } from "../store/artifacts.js";
import type { UsageRow } from "../store/usage.js";
import { MODEL_FANOUT_LIMIT, mapBounded } from "../workflow/bounded.js";

export const MODES = ["cluster", "select", "coherence", "attribute"] as const;
export type Mode = (typeof MODES)[number];

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

export async function replay(mode: Mode, store: ArtifactStore, run: number, agentsDir: string): Promise<{ artifact: unknown; usage: Usage }> {
  const usage: Usage = { calls: 0, costUsd: 0, tokens: {}, models: [], efforts: [], lostBatches: [] };
  const onUsage = (r: UsageRow) => {
    usage.calls++;
    usage.costUsd += r.costUsd;
    if (!usage.models.includes(r.model)) usage.models.push(r.model);
    if (!usage.efforts.includes(r.effort)) usage.efforts.push(r.effort);
    for (const [k, v] of Object.entries(r.tokens)) usage.tokens[k] = (usage.tokens[k] ?? 0) + v;
  };
  const deps = { store, agentsDir, onUsage };
  let out: Pointer;
  if (mode === "cluster") {
    const c = clusterActivities(deps);
    const { batches } = await c.planBatches(run);
    // Bounded as in a run; a lost batch is part of the result, as in a run (joinClusters falls back to titles).
    const settled = await mapBounded(batches, MODEL_FANOUT_LIMIT, (b) => c.extractBatch(run, b, true));
    const tags = settled.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      usage.lostBatches.push(`b${batches[i]!.index}: ${String(r.reason)}`);
      return null;
    });
    out = await c.joinClusters(run, tags, true);
  } else if (mode === "select") {
    out = await selectActivity(deps)(run, await need(store, run, "clusters.json"), await need(store, run, "recap.txt"), undefined, { force: true });
  } else if (mode === "coherence") {
    out = await coherenceActivity(deps)(run, await drafts(store, run), await need(store, run, "article_fulltext.json"), undefined, true);
  } else {
    out = await attributeActivity(deps)(run, await drafts(store, run), await need(store, run, "coherence_report.json"), await need(store, run, "repair_resolution.json"), true);
  }
  return { artifact: JSON.parse(await store.get(out)), usage };
}

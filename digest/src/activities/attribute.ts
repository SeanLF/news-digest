import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeHTML } from "entities";
import { z } from "zod";
import { CoherenceReportSchema, type Claim } from "../contracts/coherence.js";
import { assertNoUrls, scrubUrls } from "../contracts/ids.js";
import { itemIds, normHeadline, resultMatches } from "../contracts/match.js";
import { log } from "../log.js";
import { parseAgentSpec } from "../runner/prompt.js";
import { runStage, type SdkQuery } from "../runner/run-stage.js";
import type { ArtifactStore, Pointer } from "../store/artifacts.js";
import type { UsageRow } from "../store/usage.js";
import { MODEL_FANOUT_LIMIT } from "../workflow/bounded.js";
import { loadArticles } from "./cluster.js";
import { draftFrom } from "./coherence.js";
import type { ResolutionDoc } from "./repair.js";

export const ATTRIBUTION_OUTPUT = "attribution.json";
const PER_STORY_BUDGET_USD = 0.5;

export interface Differs { article_id: string; quote: string; published: string }
export interface AttributedClaim extends Claim { differs: Differs[] }
// unverified: articles said to state or differ on a claim whose quote is not in the article; never removed.
export interface StoryAttribution { complete: boolean; unverified: string[]; claims: AttributedClaim[] }
export interface AttributionDoc { input: string; stories: Record<string, StoryAttribution> }

export const storyKey = (sources: { article_id: string }[], headline: string): string => `${[...itemIds(sources)].toSorted().join(",")}|${normHeadline(headline)}`;
export const claimKey = (c: { field: string; text: string }): string => `${c.field}\u0000${c.text}`;

const Reply = z.object({
  articles: z.array(z.object({
    article_id: z.string(),
    verdicts: z.array(z.object({ claim: z.string(), verdict: z.enum(["states", "differs", "silent"]), quote: z.string().optional() })),
  })),
});
const replySchema = () => z.toJSONSchema(Reply, { target: "draft-07" });

const fold = (s: string): string => decodeHTML(s).normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐‑‒–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
export function quoteFound(quote: string, text: string): boolean {
  const q = fold(quote);
  return q.length > 0 && fold(text).includes(q);
}

export interface AttributeDeps {
  signal?: () => AbortSignal | undefined;
  store: ArtifactStore;
  agentsDir: string;
  query?: SdkQuery;
  heartbeat?: () => void;
  onUsage?: (row: UsageRow) => void | Promise<void>;
}

interface Job { key: string; headline: string; ids: string[]; claims: Claim[] }

export function attributeActivity(deps: AttributeDeps) {
  return async (runId: number, drafts: Pointer[], report: Pointer, repair: Pointer, force = false): Promise<Pointer> => {
    const { store } = deps;
    const draft = await draftFrom(store, drafts);
    const results = CoherenceReportSchema.parse(JSON.parse(await store.get(report))).results;
    const rechecks = (JSON.parse(await store.get(repair)) as ResolutionDoc).results.filter((r) => r.status === "repaired" && r.recheck_pass);
    const jobs: Job[] = [];
    for (const story of [...draft.must_know, ...draft.should_know]) {
      const ids = itemIds(story.sources);
      const idKey = [...ids].toSorted().join(",");
      const found = [...results.filter((r) => resultMatches(r, ids, normHeadline(story.headline))).flatMap((r) => r.claims ?? []), ...rechecks.filter((r) => r.article_ids.toSorted().join(",") === idKey).flatMap((r) => r.claims ?? [])];
      const claims = [...new Map(found.map((c) => [claimKey(c), c])).values()];
      if (claims.length) jobs.push({ key: storyKey(story.sources, story.headline), headline: story.headline, ids: [...ids], claims });
    }
    const input = JSON.stringify(jobs);
    const existing = await store.find(runId, ATTRIBUTION_OUTPUT);
    if (existing && !force) {
      if ((JSON.parse(await store.get(existing)) as AttributionDoc).input === input) return existing;
      await store.quarantine(runId, ATTRIBUTION_OUTPUT);
    }
    const ftPtr = await store.find(runId, "article_fulltext.json");
    const fulltext = ftPtr ? (JSON.parse(await store.get(ftPtr)) as Record<string, { text?: string }>) : {};
    const rows = new Map((await loadArticles(store, runId)).map((a) => [a.article_id, a]));
    const textOf = (id: string): string => {
      const feed = `${rows.get(id)?.title ?? ""}\n${rows.get(id)?.summary ?? ""}`;
      const full = Object.hasOwn(fulltext, id) ? fulltext[id]?.text : undefined;
      return scrubUrls(full ? `${feed}\n\n${full}` : feed);
    };
    const spec = parseAgentSpec(readFileSync(join(deps.agentsDir, "attribute.md"), "utf8"));
    const today = await store.runDate(runId);

    const ask = async (job: Job): Promise<z.infer<typeof Reply>> => {
      const message = `Story headline: ${job.headline}\n\nClaims:\n${job.claims.map((c, i) => `C${i + 1}: ${c.text}`).join("\n")}\n\nArticles:\n\n${job.ids.map((a) => `### ${a}\n${textOf(a)}`).join("\n\n")}`;
      assertNoUrls(message);
      deps.heartbeat?.();
      const r = await runStage(spec, { userMessage: message, inputDir: tmpdir() }, { today, runId, outputSchema: replySchema(), maxBudgetUsd: PER_STORY_BUDGET_USD, ...(deps.query ? { query: deps.query } : {}), ...(deps.heartbeat ? { heartbeat: deps.heartbeat } : {}), ...(deps.signal?.() ? { signal: deps.signal()! } : {}) });
      await deps.onUsage?.({ model: spec.model, thinking: spec.thinking, prompt: spec, effort: r.effort, tokens: r.usage, stage: "attribute", runId, costUsd: r.costUsd, durationMs: r.durationMs, numTurns: r.numTurns });
      return Reply.parse(r.structured);
    };
    const verdictsFrom = (reply: z.infer<typeof Reply>, job: Job) => {
      const cells = new Map<string, { verdict: string; quote?: string | undefined }>();
      for (const a of reply.articles) {
        if (!job.ids.includes(a.article_id)) continue;
        for (const v of a.verdicts) {
          const n = Number(/^C(\d+)\b/.exec(v.claim.trim())?.[1]);
          if (n >= 1 && n <= job.claims.length) cells.set(`${a.article_id}#${n - 1}`, v);
        }
      }
      return cells;
    };
    const attribute = async (job: Job): Promise<StoryAttribution> => {
      let cells = verdictsFrom(await ask(job), job);
      const pairs = job.ids.flatMap((a) => job.claims.map((_, i) => `${a}#${i}`));
      if (pairs.some((p) => !cells.has(p))) cells = new Map([...verdictsFrom(await ask(job), job), ...cells]);
      const unanswered = pairs.filter((p) => !cells.has(p)).length;
      const unverified = new Set<string>();
      const claims = job.claims.map((c, i): AttributedClaim => {
        const supported_by: string[] = [];
        const differs: Differs[] = [];
        for (const a of job.ids) {
          const v = cells.get(`${a}#${i}`);
          if (!v || v.verdict === "silent") continue;
          if (!v.quote || !quoteFound(v.quote, textOf(a))) {
            unverified.add(a);
            continue;
          }
          if (v.verdict === "states") supported_by.push(a);
          else differs.push({ article_id: a, quote: v.quote, published: rows.get(a)?.published ?? "" });
        }
        return { field: c.field, text: c.text, supported_by, differs };
      });
      if (unanswered || unverified.size) log.info({ stage: "attribute", runId, headline: job.headline, unanswered, unverified: [...unverified] });
      return { complete: unanswered === 0, unverified: [...unverified], claims };
    };

    const stories: Record<string, StoryAttribution> = {};
    const queue = [...jobs];
    await Promise.all(Array.from({ length: MODEL_FANOUT_LIMIT }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          stories[job.key] = await attribute(job);
        } catch (e) {
          if (deps.signal?.()?.aborted) throw e;
          log.warn({ stage: "attribute", runId, headline: job.headline, warning: "attribution failed for this story; it shows the checker's list and nothing is removed", error: String(e) });
          stories[job.key] = { complete: false, unverified: [], claims: [] };
        }
      }
    }));
    const text = JSON.stringify({ input, stories } satisfies AttributionDoc, null, 2);
    return force ? await store.replace(runId, ATTRIBUTION_OUTPUT, text) : await store.put(runId, ATTRIBUTION_OUTPUT, text);
  };
}

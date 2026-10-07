import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SdkQuery } from "../runner/run-stage.js";
import { ArtifactStore } from "../store/artifacts.js";
import { freshDb } from "../store/test-db.js";
import { PROD_POLICY, replay } from "./stage-replay.js";

const AGENTS = new URL("../../agents/", import.meta.url).pathname;
const WORKFLOW = readFileSync(new URL("../workflow/digest.workflow.ts", import.meta.url), "utf8");

async function selectInputs(run: number, withClusters = true): Promise<ArtifactStore> {
  const store = new ArtifactStore(await freshDb([run]));
  await store.put(run, "articles_1.csv", "article_id,source_id,title,published,summary\nA1,bbc,Vote,2026-09-18,Count\n");
  if (withClusters) await store.put(run, "clusters.json", '{"clusters":[{"story":"s","article_ids":["A1"]}]}');
  await store.put(run, "recap.txt", "recap");
  await store.put(run, "sources.csv", "id,name\nbbc,BBC\n");
  return store;
}

// A model call that never answers until its abort signal fires, as a hung CLI would.
const hangs: SdkQuery = (({ options }: { options?: Options }) =>
  (async function* () {
    await new Promise((_, reject) => options?.abortController?.signal.addEventListener("abort", () => reject(new Error("aborted by the replay's timeout"))));
    yield undefined as unknown as SDKMessage;
  })()) as unknown as SdkQuery;

describe("stage replay", () => {
  it("holds each mode to the workflow's proxy for that stage", () => {
    const proxy = (name: string) => WORKFLOW.match(new RegExp(`const ${name} = proxyActivities<Activities>\\(\\{([\\s\\S]*?)\\}\\);`))?.[1] ?? "";
    expect(proxy("model")).toMatch(/startToCloseTimeout: "45 minutes"[\s\S]*maximumAttempts: MODEL_MAX_ATTEMPTS, initialInterval: "5 minutes", backoffCoefficient: 2/);
    expect(proxy("verdict")).toMatch(/startToCloseTimeout: "45 minutes"[\s\S]*maximumAttempts: 1 /);
    expect(proxy("attributing")).toMatch(/startToCloseTimeout: "10 minutes"[\s\S]*maximumAttempts: 1 /);
    expect(WORKFLOW).toMatch(/model\.select\(/);
    expect(WORKFLOW).toMatch(/verdict\.coherence\(/);
    expect(WORKFLOW).toMatch(/attributing\.attribute\(/);
    expect(WORKFLOW).toMatch(/model\.extractBatch\(/);
    expect([PROD_POLICY.select.timeoutMs, PROD_POLICY.coherence.timeoutMs, PROD_POLICY.cluster.timeoutMs, PROD_POLICY.attribute.timeoutMs]).toEqual([45, 45, 45, 10].map((m) => m * 60_000));
  });

  it("a missing input is the harness's failure: it throws instead of counting against the variant", async () => {
    await expect(replay("select", await selectInputs(500, false), 500, AGENTS)).rejects.toThrow(/clusters\.json/);
    await expect(replay("coherence", await selectInputs(502), 502, AGENTS)).rejects.toThrow(/draft_sNN/);
    const withDraft = await selectInputs(504);
    await withDraft.put(504, "draft_s00.json", "{}");
    await expect(replay("coherence", withDraft, 504, AGENTS)).rejects.toThrow(/article_fulltext\.json/);
  });

  it("a model call that fails is a result, with what a run would have done", async () => {
    const fails: SdkQuery = (() => (async function* () {
      yield { type: "result", subtype: "error_max_structured_output_retries", is_error: true, result: "", usage: {}, total_cost_usd: 0, duration_ms: 1, num_turns: 1, session_id: "s" } as unknown as SDKMessage;
    })()) as unknown as SdkQuery;
    const r = await replay("select", await selectInputs(503), 503, AGENTS, { query: fails });
    expect(r.artifact).toBeNull();
    expect(r.failure?.error).toMatch(/error_max_structured_output_retries/);
    expect(r.failure?.prodOnFailure).toMatch(/parks for an operator/);
  });

  it("a hung model call ends at the timeout instead of hanging the replay", async () => {
    const t0 = Date.now();
    const r = await replay("select", await selectInputs(501), 501, AGENTS, { query: hangs, timeoutMs: 200 });
    expect(r.failure?.error).toMatch(/abort/i);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});

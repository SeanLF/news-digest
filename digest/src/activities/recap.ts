import type { UsageRow } from "../store/usage.js";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationFailure } from "@temporalio/common";
import { assertNoUrls } from "../contracts/ids.js";
import { parseAgentSpec } from "../runner/prompt.js";
import { runStage, type SdkQuery } from "../runner/run-stage.js";
import type { ArtifactStore, Pointer } from "../store/artifacts.js";

export const RECAP_INPUT = "recent_rss_titles.csv";
export const RECAP_OUTPUT = "recap.txt";

export function validRecap(text: string): boolean {
  return text.trim().length > 0;
}

export interface RecapDeps {
  signal?: () => AbortSignal | undefined;
  store: ArtifactStore;
  agentsDir: string;
  query?: SdkQuery;
  heartbeat?: () => void;
  onUsage?: (row: UsageRow) => void | Promise<void>;
}

export function recapActivity(deps: RecapDeps): (runId: number, force?: boolean) => Promise<Pointer> {
  return async (runId, force = false) => {
    const { store } = deps;
    const existing = await store.find(runId, RECAP_OUTPUT);
    if (existing && !force) {
      if (validRecap(await store.get(existing))) return existing;
      await store.quarantine(runId, RECAP_OUTPUT);
    }
    const input = await store.find(runId, RECAP_INPUT);
    if (!input)
      throw ApplicationFailure.nonRetryable(`run ${runId} has no ${RECAP_INPUT}; prepare has not run`, "MissingInput");
    const titles = await store.get(input);
    assertNoUrls(titles);
    const spec = parseAgentSpec(readFileSync(join(deps.agentsDir, "recap.md"), "utf8"));
    deps.heartbeat?.();
    const r = await runStage(
      spec,
      { userMessage: `Recent RSS titles (title,date):\n\n${titles}`, inputDir: tmpdir() },
      {
        today: await store.runDate(runId),
        runId,
        ...(deps.query ? { query: deps.query } : {}),
        ...(deps.heartbeat ? { heartbeat: deps.heartbeat } : {}),
        ...(deps.signal?.() ? { signal: deps.signal()! } : {}),
      },
    );
    deps.heartbeat?.();
    await deps.onUsage?.({
      model: spec.model,
      thinking: spec.thinking,
      prompt: spec,
      effort: r.effort,
      tokens: r.usage,
      stage: "recap",
      runId,
      costUsd: r.costUsd,
      durationMs: r.durationMs,
      numTurns: r.numTurns,
    });
    const text = r.text.trim();
    if (!validRecap(text)) throw new Error(`recap for run ${runId}: model returned an empty recap`);
    return force ? await store.replace(runId, RECAP_OUTPUT, text) : await store.put(runId, RECAP_OUTPUT, text);
  };
}

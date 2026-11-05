import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@temporalio/activity";
import { assertNoUrls } from "../contracts/ids.js";
import { log } from "../log.js";
import { previousHeadlines, runAt } from "../prepare/context.js";
import { parseAgentSpec } from "../runner/prompt.js";
import { runStage, type SdkQuery } from "../runner/run-stage.js";
import type { ArtifactStore, Pointer } from "../store/artifacts.js";
import { openDb, type RowOf } from "../store/db.js";
import type { UsageRow } from "../store/usage.js";

export const WEEKLY_RECAP = "weekly_recap.txt";
export const WEEKLY_RECAP_MAX_WEEKS = 6;
const DAY_MS = 86_400_000;

export interface WeeklyRecapDeps {
  store: ArtifactStore;
  dbUrl: string;
  agentsDir: string;
  maxAttempts: number;
  attempt?: () => number;
  query?: SdkQuery;
  heartbeat?: () => void;
  signal?: () => AbortSignal | undefined;
  onUsage?: (row: UsageRow) => void | Promise<void>;
}

const currentAttempt = (): number => {
  try {
    return Context.current().info.attempt;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export function weeklyRecapActivity(
  deps: WeeklyRecapDeps,
): (runId: number, force?: boolean) => Promise<Pointer | null> {
  return async (runId, force = false) => {
    const { store } = deps;
    const existing = await store.find(runId, WEEKLY_RECAP);
    if (existing && !force) return existing;
    const write = (text: string): Promise<Pointer> =>
      force ? store.replace(runId, WEEKLY_RECAP, text) : store.put(runId, WEEKLY_RECAP, text);
    const db = openDb(deps.dbUrl);
    const prior =
      (
        await db.one<Pick<RowOf<"artifacts">, "content">>(
          "SELECT content FROM artifacts WHERE name=$1 AND run_id < $2 AND status = 'current' ORDER BY run_id DESC LIMIT 1",
          [WEEKLY_RECAP, runId],
        )
      )?.content ?? null;
    const titles = (await previousHeadlines(db, await runAt(db, runId)))
      .map((t) => t.headline)
      .filter(Boolean)
      .map((t) => `- ${t}`)
      .join("\n");
    const carry = async (): Promise<Pointer | null> => (prior === null ? null : write(prior));
    const today = await store.runDate(runId);
    const last = prior === null ? undefined : [...prior.matchAll(/^## Week of (\d{4}-\d{2}-\d{2})/gm)].at(-1)?.[1];
    const age = last ? (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / DAY_MS : Number.NaN;
    if (age < 7) return carry();
    if (!titles) return carry();
    assertNoUrls(titles);
    let summary: string;
    try {
      const spec = parseAgentSpec(readFileSync(join(deps.agentsDir, "weekly-recap.md"), "utf8"));
      deps.heartbeat?.();
      const r = await runStage(
        spec,
        { userMessage: titles, inputDir: tmpdir() },
        {
          today,
          runId,
          ...(deps.query ? { query: deps.query } : {}),
          ...(deps.heartbeat ? { heartbeat: deps.heartbeat } : {}),
          ...(deps.signal?.() ? { signal: deps.signal()! } : {}),
        },
      );
      await deps.onUsage?.({
        model: spec.model,
        thinking: spec.thinking,
        prompt: spec,
        effort: r.effort,
        tokens: r.usage,
        stage: "weekly_recap",
        runId,
        costUsd: r.costUsd,
        durationMs: r.durationMs,
        numTurns: r.numTurns,
      });
      summary = r.text.trim();
      if (!summary) throw new Error("model returned an empty recap");
    } catch (e) {
      if (deps.signal?.()?.aborted) throw e;
      if ((deps.attempt ?? currentAttempt)() < deps.maxAttempts) throw e;
      log.warn(`Weekly recap generation failed (non-fatal): ${String(e)}`);
      return carry();
    }
    const sections = (prior ?? "").split(/(?=^## Week of )/m).filter((s) => s.trim());
    sections.push(`## Week of ${today}\n${summary}\n\n`);
    return write(sections.slice(-WEEKLY_RECAP_MAX_WEEKS).join(""));
  };
}

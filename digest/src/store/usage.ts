import type { StageSpec } from "../runner/prompt.js";
import { sha256 } from "./artifacts.js";
import type { Sql } from "./db.js";

export interface UsageRow {
  stage: string;
  runId: number;
  model: string;
  thinking: string;
  effort: string;
  costUsd: number;
  durationMs: number;
  tokens: Record<string, number>;
  prompt?: Pick<StageSpec, "name" | "body" | "tools" | "thinking">;
  [detail: string]: unknown;
}

function branchOf(row: UsageRow): string | null {
  if (typeof row["story"] === "number") return `s${String(row["story"]).padStart(2, "0")}`;
  if (typeof row["batch"] === "number") return `b${row["batch"]}`;
  if (typeof row["thread"] === "number") return `t${row["thread"]}`;
  return null;
}

async function promptSha256(db: Sql, row: UsageRow): Promise<string | null> {
  if (!row.prompt) return null;
  const { name, body, tools, thinking } = row.prompt;
  const text = `${body}\n---\n${JSON.stringify({ tools, thinking })}`;
  const sha = sha256(text);
  await db.run(
    "INSERT INTO prompts (sha256, name, body, first_run_id) VALUES ($1, $2, $3, $4) ON CONFLICT (sha256) DO NOTHING",
    [sha, name, text, row.runId],
  );
  return sha;
}

export async function recordUsage(db: Sql, row: UsageRow): Promise<void> {
  const t = row.tokens;
  await db.run(
    `INSERT INTO model_calls (run_id, attempt_id, stage, branch, request_model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, api_cost_usd, duration_ms, thinking, effort, prompt_sha256, outcome)
     VALUES ($1, (SELECT max(id) FROM run_attempts WHERE run_id = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ok')`,
    [
      row.runId,
      row.stage,
      branchOf(row),
      row.model,
      t["input_tokens"] ?? 0,
      t["output_tokens"] ?? 0,
      t["cache_creation_input_tokens"] ?? 0,
      t["cache_read_input_tokens"] ?? 0,
      row.costUsd,
      Math.round(row.durationMs),
      row.thinking,
      row.effort,
      await promptSha256(db, row),
    ],
  );
}

export async function runCost(db: Sql, runId: number, since: string): Promise<{ costUsd: number; calls: number }> {
  const r = await db.one<{ c: number; n: number }>(
    "SELECT COALESCE(SUM(api_cost_usd), 0) AS c, COUNT(*) AS n FROM model_calls WHERE run_id=$1 AND recorded_at >= $2::timestamp AT TIME ZONE 'UTC'",
    [runId, since],
  );
  return { costUsd: r!.c, calls: r!.n };
}

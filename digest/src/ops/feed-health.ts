import type { RowOf, Sql } from "../store/db.js";
import type { AlertRequest } from "./alerts.js";

export const FROZEN_DAYS = 12;

type Health = { failing: [string, number][]; frozen: [string, number][] };

async function healthAsOf(db: Sql, runId: number, fetchSet: readonly string[], threshold: number): Promise<Health> {
  const cutoff = await db.one<{ at: string | null }>(
    "SELECT max(fetched_at)::text AS at FROM source_fetches WHERE run_id = $1",
    [runId],
  );
  if (!cutoff?.at) return { failing: [], frozen: [] };
  const recent = await db.all<{ id: string }>(
    "SELECT DISTINCT source_id AS id FROM source_fetches WHERE fetched_at > $1::timestamptz - interval '7 days' AND fetched_at <= $1::timestamptz",
    [cutoff.at],
  );
  const fetched = new Set(fetchSet);
  const failing: [string, number][] = [];
  const frozen: [string, number][] = [];
  for (const { id } of recent) {
    if (!fetched.has(id)) continue;
    const rows = await db.all<Pick<RowOf<"source_fetches">, "is_success" | "articles_kept">>(
      "SELECT is_success, articles_kept FROM source_fetches WHERE source_id = $1 AND fetched_at <= $2::timestamptz ORDER BY fetched_at DESC, id DESC LIMIT 10",
      [id, cutoff.at],
    );
    const streak = rows.findIndex((r) => r.is_success);
    const count = streak === -1 ? rows.length : streak;
    if (count >= threshold) {
      failing.push([id, count]);
      continue;
    }
    if (!rows[0]?.is_success || rows[0].articles_kept !== 0) continue;
    const stale = await db.one<{ days: number }>(
      `SELECT floor(extract(epoch FROM $2::timestamptz - coalesce(
         max(fetched_at) FILTER (WHERE articles_kept > 0), min(fetched_at))) / 86400)::int AS days
       FROM source_fetches WHERE source_id = $1 AND fetched_at <= $2::timestamptz`,
      [id, cutoff.at],
    );
    if (stale && stale.days >= FROZEN_DAYS) frozen.push([id, stale.days]);
  }
  return { failing, frozen };
}

const ids = (h: Health): Set<string> => new Set([...h.failing, ...h.frozen].map(([id]) => id));
const worstFirst = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);

export async function feedHealthAlert(
  db: Sql,
  runId: number,
  fetchSet: readonly string[],
  threshold: number,
): Promise<Extract<AlertRequest, { kind: "source-health" }> | null> {
  const health = await healthAsOf(db, runId, fetchSet, threshold);
  const now = ids(health);
  if (!now.size) return null;
  const previousRun = await db.one<{ id: number | null }>(
    "SELECT max(run_id) AS id FROM source_fetches WHERE run_id < $1",
    [runId],
  );
  const before =
    previousRun?.id == null ? new Set<string>() : ids(await healthAsOf(db, previousRun.id, fetchSet, threshold));
  const started = [...now].filter((id) => !before.has(id)).toSorted();
  const recovered = [...before].filter((id) => !now.has(id)).toSorted();
  if (!started.length && !recovered.length) return null;
  const r = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM source_fetches WHERE run_id = $1 AND NOT is_success",
    [runId],
  );
  return {
    kind: "source-health",
    failing: health.failing.toSorted(worstFirst),
    frozen: health.frozen.toSorted(worstFirst),
    frozenDays: FROZEN_DAYS,
    failedThisRun: r!.n,
    totalSources: fetchSet.length,
    threshold,
    started,
    recovered,
  };
}

import type { RowOf, Sql } from "../store/db.js";
import type { AlertRequest } from "./alerts.js";

async function failingAsOf(
  db: Sql,
  runId: number,
  fetchSet: readonly string[],
  threshold: number,
): Promise<[string, number][]> {
  const cutoff = await db.one<{ at: string | null }>(
    "SELECT max(fetched_at)::text AS at FROM source_fetches WHERE run_id = $1",
    [runId],
  );
  if (!cutoff?.at) return [];
  const recent = await db.all<{ id: string }>(
    "SELECT DISTINCT source_id AS id FROM source_fetches WHERE fetched_at > $1::timestamptz - interval '7 days' AND fetched_at <= $1::timestamptz",
    [cutoff.at],
  );
  const fetched = new Set(fetchSet);
  const failing: [string, number][] = [];
  for (const { id } of recent) {
    if (!fetched.has(id)) continue;
    const rows = await db.all<Pick<RowOf<"source_fetches">, "is_success">>(
      "SELECT is_success FROM source_fetches WHERE source_id = $1 AND fetched_at <= $2::timestamptz ORDER BY fetched_at DESC, id DESC LIMIT 10",
      [id, cutoff.at],
    );
    const streak = rows.findIndex((r) => r.is_success);
    const count = streak === -1 ? rows.length : streak;
    if (count >= threshold) failing.push([id, count]);
  }
  return failing;
}

export async function feedHealthAlert(
  db: Sql,
  runId: number,
  fetchSet: readonly string[],
  threshold: number,
): Promise<Extract<AlertRequest, { kind: "source-health" }> | null> {
  const failing = await failingAsOf(db, runId, fetchSet, threshold);
  if (!failing.length) return null;
  const previousRun = await db.one<{ id: number | null }>(
    "SELECT max(run_id) AS id FROM source_fetches WHERE run_id < $1",
    [runId],
  );
  const before = new Set(
    previousRun?.id == null ? [] : (await failingAsOf(db, previousRun.id, fetchSet, threshold)).map(([id]) => id),
  );
  const now = new Set(failing.map(([id]) => id));
  const started = [...now].filter((id) => !before.has(id)).toSorted();
  const recovered = [...before].filter((id) => !now.has(id)).toSorted();
  if (!started.length && !recovered.length) return null;
  failing.sort((a, b) => b[1] - a[1]);
  const r = await db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM source_fetches WHERE run_id = $1 AND NOT is_success",
    [runId],
  );
  return {
    kind: "source-health",
    failing,
    failedThisRun: r!.n,
    totalSources: fetchSet.length,
    threshold,
    started,
    recovered,
  };
}

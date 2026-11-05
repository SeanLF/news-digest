import type { RowOf, Sql } from "../store/db.js";

export async function runAt(db: Sql, runId: number): Promise<string> {
  const r = await db.one<Pick<RowOf<"runs">, "started_at">>("SELECT started_at FROM runs WHERE id=$1", [runId]);
  if (!r) throw new Error(`no run ${runId}`);
  return r.started_at;
}

const at = "$1::timestamp AT TIME ZONE 'UTC'";
const utcDay = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

export function previousHeadlines(
  db: Sql,
  when: string,
  days = 7,
): Promise<{ headline: string; tier: string; date: string }[]> {
  return db.all(
    `SELECT COALESCE(source_title, headline) AS headline, tier, ${utcDay("shown_at")} AS date FROM story_sources
     WHERE shown_at > ${at} - make_interval(days => $2) AND shown_at < ${at} ORDER BY shown_at DESC, id DESC`,
    [when, days],
  );
}

export function yesterdayHeadlines(db: Sql, when: string): Promise<{ headline: string; tier: string }[]> {
  return db.all(
    `SELECT headline, tier FROM story_sources
     WHERE run_id = (SELECT id FROM runs WHERE id IN (SELECT run_id FROM sent_runs) AND started_at < ${at} ORDER BY started_at DESC LIMIT 1)
       AND tier IN ('must_know', 'should_know') ORDER BY tier COLLATE "C", headline COLLATE "C"`,
    [when],
  );
}

export async function recentDigestHeadlines(
  db: Sql,
  when: string,
  days = 7,
): Promise<{ headline: string; tier: string; date: string }[]> {
  const rows = await db.all<{ headline: string; tier: string; last_shown: string }>(
    `SELECT * FROM (SELECT DISTINCT ON (sn.headline COLLATE "C") sn.headline AS headline, sn.tier AS tier, dr.started_at AS last_shown
     FROM story_sources sn JOIN runs dr ON dr.id = sn.run_id
     WHERE dr.id IN (SELECT run_id FROM sent_runs) AND (dr.started_at AT TIME ZONE 'UTC')::date >= (${at} AT TIME ZONE 'UTC')::date - $2::int AND dr.started_at < ${at}
       AND sn.tier IN ('must_know', 'should_know') AND sn.headline IS NOT NULL AND sn.headline != ''
     ORDER BY sn.headline COLLATE "C", dr.started_at DESC, sn.id) x
     ORDER BY last_shown DESC, headline COLLATE "C" DESC`,
    [when, days],
  );
  return rows.map((r) => ({ headline: r.headline, tier: r.tier, date: r.last_shown.slice(0, 10) }));
}

export const recentTitlesCsv = (rows: { headline: string; date: string }[]): string =>
  ["title,date", ...rows.map((r) => [r.headline, r.date].map(csvField).join(","))].join("\n") + "\n";
export const yesterdayTxt = (rows: { headline: string; tier: string }[]): string =>
  rows.map((r) => `${r.tier}: ${r.headline}\n`).join("");
export const recentTxt = (rows: { headline: string; tier: string; date: string }[]): string =>
  rows.map((r) => `${r.date} | ${r.tier}: ${r.headline}\n`).join("");
function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

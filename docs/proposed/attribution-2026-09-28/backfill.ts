import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkDraft } from "./dist/activities/coherence.js";
const dates: Record<string, string> = { "307": "2026-09-25", "308": "2026-09-26", "309": "2026-09-27", "310": "2026-09-28" };
for (const rep of [1, 2]) for (const run of Object.keys(dates)) {
  const dir = `/scratch/backfill/${run}`;
  const corpus = readdirSync(dir).filter((n) => /^articles_\d+\.csv$/.test(n) || n === "article_fulltext.json").toSorted().map((n): [string, string] => [n, readFileSync(join(dir, n), "utf8")]);
  const t0 = Date.now();
  const r = await checkDraft({ agentsDir: "/app/digest/agents/" }, readFileSync(join(dir, "draft_selections.json"), "utf8"), corpus, dates[run]!, undefined, "read-loop");
  writeFileSync(join(dir, `rep${rep}.json`), JSON.stringify(r.report, null, 2));
  console.log(JSON.stringify({ run, rep, costUsd: r.costUsd, s: Math.round((Date.now() - t0) / 1000), stories: r.report.results.length, withClaims: r.report.results.filter((x) => x.claims?.length).length }));
}

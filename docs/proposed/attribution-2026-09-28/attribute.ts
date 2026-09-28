import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { runStage } from "./dist/runner/run-stage.js";
import { parseAgentSpec } from "./dist/runner/prompt.js";

const MODEL = process.env.ATTR_MODEL ?? "claude-haiku-4-5";
const THINKING = process.env.ATTR_THINKING ?? "disabled";
const TAG = process.env.ATTR_TAG ?? "haiku";
const REP = process.env.ATTR_REP ?? "rep1";
const spec = parseAgentSpec(readFileSync(process.env.ATTR_SPEC ?? "/scratch/attr-agents/attribute.md", "utf8").replace("MODEL", MODEL).replace("THINKING", THINKING));
const dates: Record<string, string> = { "307": "2026-09-25", "308": "2026-09-26", "309": "2026-09-27", "310": "2026-09-28" };
const schema = { type: "object", required: ["articles"], properties: { articles: { type: "array", items: { type: "object", required: ["article_id", "verdicts"], properties: { article_id: { type: "string" }, verdicts: { type: "array", items: { type: "object", required: ["claim", "verdict"], properties: { claim: { type: "string" }, verdict: { enum: ["states", "contradicts", "differs", "silent"] }, quote: { type: "string" } } } } } } } } };
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim().toLowerCase();

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { for (let t = q.shift(); t !== undefined; t = q.shift()) await f(t); }));
}

let total = 0;
for (const run of (process.env.ATTR_RUNS ?? "307,308,309,310").split(",")) {
  const dir = `/scratch/backfill/${run}`;
  const draft = JSON.parse(readFileSync(join(dir, "draft_selections.json"), "utf8"));
  const ft = JSON.parse(readFileSync(join(dir, "article_fulltext.json"), "utf8")) as Record<string, { text?: string }>;
  const rows = new Map<string, { title: string; summary: string; source_id: string }>();
  for (const n of readdirSync(dir).filter((x) => /^articles_\d+\.csv$/.test(x))) for (const r of parse(readFileSync(join(dir, n), "utf8"), { columns: true }) as Record<string, string>[]) rows.set(r.article_id!, r as never);
  const results = JSON.parse(readFileSync(join(dir, `${REP}.json`), "utf8")).results as { headline: string; article_ids: string[]; claims?: { field: string; text: string; supported_by: string[] }[] }[];
  let stories = (["must_know", "should_know"] as const).flatMap((t) => draft[t].map((s: { headline: string; sources: { article_id: string }[] }) => ({ tier: t, ...s })));
  if (process.env.ATTR_LIMIT) stories = stories.slice(0, Number(process.env.ATTR_LIMIT));
  const out: unknown[] = [];
  await pool(stories, 4, async (st) => {
    const ids = [...new Set(st.sources.map((s) => s.article_id))];
    const key = [...ids].sort().join(",");
    const res = results.filter((r) => [...new Set(r.article_ids)].sort().join(",") === key);
    const m = res.length ? res : results.filter((r) => r.headline.trim() === st.headline.trim());
    const claims = m.flatMap((r) => r.claims ?? []).filter((c) => st.tier === "must_know" || c.field !== "why_it_matters");
    if (!claims.length) return;
    const text = (a: string) => { const t = ft[a]?.text; const r = rows.get(a); return t ? { kind: t.endsWith("\n[truncated]") ? "truncated" : "full", text: t } : { kind: "summary", text: `${r?.title ?? ""}\n${r?.summary ?? ""}` }; };
    const msg = `Story headline: ${st.headline}\n\nClaims:\n${claims.map((c, i) => `C${i + 1}: ${c.text}`).join("\n")}\n\nArticles:\n\n${ids.map((a) => `### ${a}\n${text(a).text}`).join("\n\n")}`;
    const r = await runStage(spec, { userMessage: msg, inputDir: mkdtempSync(join(tmpdir(), "attr-")) }, { today: dates[run]!, outputSchema: schema });
    total += r.costUsd;
    const got = (r.structured as { articles: { article_id: string; verdicts: { claim: string; verdict: string; quote?: string }[] }[] }).articles;
    const cells = ids.flatMap((a) => claims.map((c, i) => {
      const v = got.find((x) => x.article_id === a)?.verdicts.find((x) => x.claim.match(/^C(\d+)\b/)?.[1] === String(i + 1));
      const t = text(a);
      return { article: a, read: t.kind, claim: c.text, checker: c.supported_by.includes(a), verdict: v?.verdict === "differs" ? "contradicts" : (v?.verdict ?? "MISSING"), quote: v?.quote, quoteOk: v?.quote ? norm(t.text).includes(norm(v.quote)) : null };
    }));
    out.push({ run, tier: st.tier, headline: st.headline, cells, raw: got });
  });
  writeFileSync(join(dir, `attr-${TAG}-${REP}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ run, stories: out.length, costSoFar: total }));
}

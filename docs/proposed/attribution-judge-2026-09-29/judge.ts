import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { checkDraft } from "./dist/activities/coherence.js";
import { quoteFound } from "./dist/activities/attribute.js";
import { scorePlanted } from "./dist/gate/planted-score.js";
import { itemIds, normHeadline, resultMatches } from "./dist/contracts/match.js";
import { runStage } from "./dist/runner/run-stage.js";
import { parseAgentSpec } from "./dist/runner/prompt.js";

const FX = "/planted/fixtures/planted278";
const OUT = "/scratch/judge/out";
const TODAY = "2026-08-28";
const key = JSON.parse(readFileSync("/planted/planted278_key.json", "utf8"));
const draftText = readFileSync(`${FX}/draft_selections.json`, "utf8");
const draft = JSON.parse(draftText);
const stories = [...draft.must_know, ...(draft.should_know ?? [])] as { headline: string; summary: string; why_it_matters?: string; sources: { article_id: string }[] }[];
const ft = JSON.parse(readFileSync(`${FX}/article_fulltext.json`, "utf8")) as Record<string, { text?: string }>;
const rows = new Map<string, Record<string, string>>();
const csvs = ["articles_1.csv", "articles_2.csv", "articles_3.csv", "articles_4.csv", "articles_5.csv"];
for (const n of csvs) for (const r of parse(readFileSync(`${FX}/${n}`, "utf8"), { columns: true, relax_column_count: true }) as Record<string, string>[]) rows.set(r.article_id!, r);
const textOf = (id: string) => { const feed = `${rows.get(id)?.title ?? ""}\n${rows.get(id)?.summary ?? ""}`; const f = ft[id]?.text; return f ? `${feed}\n\n${f}` : feed; };

type Claim = { field: string; text: string };
type Cell = { verdict: string; quote?: string | undefined };

// ---- negative controls on the scorer
{
  const all = { results: stories.map((s) => ({ headline: s.headline, article_ids: [...itemIds(s.sources)], pass: false, reason: "x", failed_fields: ["headline", "summary", "why_it_matters"] })) };
  const none = { results: stories.map((s) => ({ headline: s.headline, article_ids: [...itemIds(s.sources)], pass: true, reason: "x" })) };
  const a = scorePlanted(all as never, draft, key), n = scorePlanted(none as never, draft, key);
  console.log(JSON.stringify({ control_all_fail: a, control_none_fail: n }));
  if (a.recall !== 8 || a.falseDrops !== 20 || n.recall !== 0 || n.falseDrops !== 0) throw new Error("scorer negative control failed");
}

const attrSpec = parseAgentSpec(readFileSync("/app/digest/agents/attribute.md", "utf8"));
const Reply = z.object({ articles: z.array(z.object({ article_id: z.string(), verdicts: z.array(z.object({ claim: z.string(), verdict: z.enum(["states", "differs", "silent"]), quote: z.string().optional() })) })) });
const replySchema = z.toJSONSchema(Reply, { target: "draft-07" });
const ClaimsReply = z.object({ claims: z.array(z.object({ field: z.enum(["headline", "summary", "why_it_matters"]), text: z.string() })) });

async function pool<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (let j = i++; j < xs.length; j = i++) out[j] = await f(xs[j]!, j); }));
  return out;
}

async function attributeStory(s: (typeof stories)[number], claims: Claim[]) {
  const ids = [...itemIds(s.sources)];
  let cost = 0;
  const ask = async () => {
    const msg = `Story headline: ${s.headline}\n\nClaims:\n${claims.map((c, i) => `C${i + 1}: ${c.text}`).join("\n")}\n\nArticles:\n\n${ids.map((a) => `### ${a}\n${textOf(a)}`).join("\n\n")}`;
    const r = await runStage(attrSpec, { userMessage: msg, inputDir: tmpdir() }, { today: TODAY, outputSchema: replySchema, maxBudgetUsd: 1 });
    cost += r.costUsd;
    const cells = new Map<string, Cell>();
    for (const a of Reply.parse(r.structured).articles) {
      if (!ids.includes(a.article_id)) continue;
      for (const v of a.verdicts) { const n = Number(/^C(\d+)\b/.exec(v.claim.trim())?.[1]); if (n >= 1 && n <= claims.length) cells.set(`${a.article_id}#${n - 1}`, v); }
    }
    return cells;
  };
  let cells = await ask();
  const pairs = ids.flatMap((a) => claims.map((_, i) => `${a}#${i}`));
  if (pairs.some((p) => !cells.has(p))) cells = new Map([...(await ask()), ...cells]);
  const missing = pairs.filter((p) => !cells.has(p)).length;
  const per = claims.map((c, i) => {
    const states: string[] = [], differs: string[] = [], unverified: string[] = [], quotes: Record<string, string> = {};
    for (const a of ids) {
      const v = cells.get(`${a}#${i}`);
      if (!v || v.verdict === "silent") continue;
      if (!v.quote || !quoteFound(v.quote, textOf(a))) { unverified.push(a); continue; }
      (v.verdict === "states" ? states : differs).push(a);
      quotes[a] = `${v.verdict}: ${v.quote}`;
    }
    return { ...c, states, differs, unverified, quotes };
  });
  return { per, cost, missing, pairs: pairs.length };
}

type Rule = "strict" | "lenient" | "strict_differs";
function verdictReport(attributed: { per: { field: string; states: string[]; differs: string[] }[] }[], rule: Rule) {
  return { results: stories.map((s, i) => {
    const failed = new Set<string>();
    for (const c of attributed[i]!.per) {
      const fail = rule === "strict" ? c.states.length === 0 : rule === "lenient" ? c.states.length === 0 && c.differs.length === 0 : c.states.length === 0 || c.differs.length > 0;
      if (fail) failed.add(c.field);
    }
    if (!s.why_it_matters) failed.delete("why_it_matters");
    return { headline: s.headline, article_ids: [...itemIds(s.sources)], pass: failed.size === 0, reason: "attr", failed_fields: [...failed] };
  }) };
}

async function listClaims(model: string, s: (typeof stories)[number]) {
  const spec = parseAgentSpec(readFileSync("/scratch/judge/agents/claim-list.md", "utf8").replace("MODEL", model));
  const msg = JSON.stringify({ headline: s.headline, summary: s.summary, ...(s.why_it_matters ? { why_it_matters: s.why_it_matters } : {}) }, null, 2);
  const r = await runStage(spec, { userMessage: msg, inputDir: tmpdir() }, { today: TODAY, outputSchema: z.toJSONSchema(ClaimsReply, { target: "draft-07" }) });
  return { claims: ClaimsReply.parse(r.structured).claims, cost: r.costUsd };
}

const arm = process.argv[2]!, rep = process.argv[3]!;
const t0 = Date.now();
const corpus: [string, string][] = [...csvs, "article_fulltext.json"].map((n) => [n, readFileSync(`${FX}/${n}`, "utf8")]);
if (arm === "A") {
  const r = await checkDraft({ agentsDir: "/app/digest/agents/" }, draftText, corpus, TODAY, undefined, "read-loop");
  writeFileSync(`${OUT}/A-${rep}.json`, JSON.stringify(r.report, null, 2));
  console.log(JSON.stringify({ arm, rep, score: scorePlanted(r.report, draft, key), cost: r.costUsd, s: Math.round((Date.now() - t0) / 1000) }));
} else {
  let claimsPer: Claim[][]; let listCost = 0;
  if (arm === "B") {
    const rpt = JSON.parse(readFileSync(`${OUT}/A-${rep}.json`, "utf8"));
    claimsPer = stories.map((s) => rpt.results.filter((r: never) => resultMatches(r, itemIds(s.sources), normHeadline(s.headline))).flatMap((r: { claims?: Claim[] }) => (r.claims ?? []).map((c) => ({ field: c.field, text: c.text }))));
  } else {
    const model = arm === "C" ? "claude-sonnet-5-5" : "claude-haiku-4-5";
    const listed = await pool(stories, 4, (s) => listClaims(model, s));
    claimsPer = listed.map((l) => l.claims); listCost = listed.reduce((a, l) => a + l.cost, 0);
  }
  const attributed = await pool(stories, 4, (s, i) => attributeStory(s, claimsPer[i]!));
  const missing = attributed.reduce((a, x) => a + x.missing, 0), pairs = attributed.reduce((a, x) => a + x.pairs, 0);
  const attrCost = attributed.reduce((a, x) => a + x.cost, 0);
  writeFileSync(`${OUT}/${arm}-${rep}.json`, JSON.stringify(stories.map((s, i) => ({ idx: i, headline: s.headline, claims: attributed[i]!.per })), null, 2));
  const scores = Object.fromEntries((["strict", "lenient", "strict_differs"] as Rule[]).map((rule) => [rule, scorePlanted(verdictReport(attributed, rule) as never, draft, key)]));
  console.log(JSON.stringify({ arm, rep, missing, pairs, listCost, attrCost, cost: listCost + attrCost, s: Math.round((Date.now() - t0) / 1000), scores }));
}
process.exit(0);

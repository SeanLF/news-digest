import { firstJsonObject, jsonObjects } from "./json.js";
import { log } from "../log.js";
import type { ThreadStore } from "./store.js";
import { cited, cleanQuestions } from "./text.js";

export interface Art {
  title: string;
  summary: string;
}
export type Arts = ReadonlyMap<string, Art>;

export const SUMMARY_CHARS = 400;
const head = (s: string, n = SUMMARY_CHARS): string => {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n).join("");
};

const ENTITY = /[A-Z][A-Za-z'&.-]+(?:\s+[A-Z][A-Za-z'&.-]+)*/g;
const LB_STOP = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "their",
  "his",
  "her",
  "our",
  "your",
  "new",
  "but",
  "and",
  "for",
]);
const stripEnds = (w: string): string => w.replace(/^[.'&]+|[.'&]+$/g, "");

export function articleSignature(art: Art): Set<string> {
  const sig = new Set<string>();
  for (const ent of `${art.title} ${head(art.summary)}`.match(ENTITY) ?? [])
    for (const raw of ent.toLowerCase().split(/[\s-]+/)) {
      const w = stripEnds(raw);
      if (Array.from(w).length >= 3 && !LB_STOP.has(w)) sig.add(w);
    }
  return sig;
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
};

function hubEntities(sigs: Map<string, Set<string>>, maxDf: number): Set<string> {
  const counts = new Map<string, number>();
  for (const sig of sigs.values()) for (const t of sig) counts.set(t, (counts.get(t) ?? 0) + 1);
  return new Set([...counts].filter(([, c]) => c / sigs.size > maxDf).map(([t]) => t));
}

export function expandNeighbourhood(
  seedIds: string[],
  arts: Arts,
  threshold: number,
  maxExtra: number,
  hubMaxDf = 0.12,
): string[] {
  const sigs = new Map([...arts].map(([id, a]) => [id, articleSignature(a)]));
  const hubs = sigs.size >= 30 ? hubEntities(sigs, hubMaxDf) : new Set<string>();
  const disc = new Map([...sigs].map(([id, s]) => [id, new Set([...s].filter((t) => !hubs.has(t)))]));
  const seed = seedIds.filter((a) => arts.has(a));
  const seedSigs = seed.map((a) => disc.get(a)!).filter((s) => s.size > 0);
  if (!seedSigs.length) return [...seedIds];
  const seedSet = new Set(seed);
  const scored: [number, string][] = [];
  for (const id of arts.keys()) {
    if (seedSet.has(id)) continue;
    const best = Math.max(0, ...seedSigs.map((s) => jaccard(disc.get(id)!, s)));
    if (best >= threshold) scored.push([best, id]);
  }
  scored.sort((x, y) => y[0] - x[0] || (y[1] < x[1] ? -1 : y[1] > x[1] ? 1 : 0));
  return [...seedIds, ...scored.slice(0, maxExtra).map(([, id]) => id)];
}

export function bundle(articleIds: string[], arts: Arts): string {
  return articleIds
    .flatMap((a) => {
      const art = arts.get(a);
      return art ? [`${a}: ${art.title}\n   ${head(art.summary)}`] : [];
    })
    .join("\n\n");
}

export function synthesisPrompt(
  recentUpdates: string[],
  openQuestions: string[],
  articleIds: string[],
  arts: Arts,
): string {
  const updates =
    recentUpdates.map((u) => `- ${u}`).join("\n") || "(nothing yet -- this is the thread's first tracked day)";
  const questions = openQuestions.map((q) => `- ${q}`).join("\n") || "(none yet)";
  return `RECENT UPDATES:\n${updates}\nOPEN QUESTIONS:\n${questions}\n\nTODAY'S SOURCE ARTICLES:\n${bundle(articleIds, arts)}`;
}

export type Installment = Record<string, unknown>;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const whatsNewOf = (inst: Installment): unknown[] => list(inst["whats_new"]);

export const parseInstallment = (text: string): Installment => firstJsonObject(text);

export function pyRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  const body = Array.from(s, (c) => {
    if (c === "\\" || c === q) return `\\${c}`;
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    const code = c.codePointAt(0)!;
    return code < 0x20 || code === 0x7f ? `\\x${code.toString(16).padStart(2, "0")}` : c;
  }).join("");
  return `${q}${body}${q}`;
}
const pyList = (xs: unknown[]): string =>
  `[${xs.map((x) => (typeof x === "string" ? pyRepr(x) : String(x))).join(", ")}]`;
const pyType = (v: unknown): string =>
  v === null
    ? "NoneType"
    : Array.isArray(v)
      ? "list"
      : typeof v === "string"
        ? "str"
        : typeof v === "boolean"
          ? "bool"
          : typeof v === "number"
            ? Number.isInteger(v)
              ? "int"
              : "float"
            : "dict";

export function auditPrompt(whatsNew: unknown[], arts: Arts): string {
  return whatsNew
    .map((f, i) => {
      if (!isObject(f)) throw new Error(`fact ${i + 1} is not an object`);
      const sources = f["sources"] === undefined ? [] : f["sources"];
      if (typeof sources !== "string" && !Array.isArray(sources))
        throw new Error(`fact ${i + 1} has sources that are not a list`);
      const srcs = (typeof sources === "string" ? Array.from(sources) : sources)
        .flatMap((s) => {
          const a = typeof s === "string" ? arts.get(s) : undefined;
          return a ? [`  [${s as string}] ${a.title}. ${head(a.summary)}`] : [];
        })
        .join("\n");
      const fact = f["fact"] === undefined ? "" : typeof f["fact"] === "string" ? f["fact"] : JSON.stringify(f["fact"]);
      return `CLAIM ${i + 1}: ${fact}\nCITED SOURCE(S):\n${srcs || "  (none cited)"}`;
    })
    .join("\n\n");
}

export const auditReask = (problem: string, n: number): string =>
  `\n\nIMPORTANT: an earlier attempt at these exact claims came back unusable (${problem}). Return EXACTLY ${n} verdicts, ids 1 through ${n}, one per CLAIM above, each carrying "supported": true or false. Output ONE JSON object and nothing else -- no prose, no second attempt inside the same reply.`;

const TRUTHY = new Set(["true", "yes", "y", "1"]);
const FALSY = new Set(["false", "no", "n", "0"]);
export function readSupported(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === 0 || v === 1) return v === 1;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (TRUTHY.has(t)) return true;
    if (FALSY.has(t)) return false;
  }
  return undefined;
}

function verdictPairs(raw: unknown[]): { pairs: [unknown, boolean][]; unreadable: number } {
  const pairs: [unknown, boolean][] = [];
  let unreadable = 0;
  for (const v of raw) {
    if (!isObject(v) || !("id" in v) || !("supported" in v)) continue;
    let s = readSupported(v["supported"]);
    if (s === undefined) {
      s = false;
      unreadable++;
    }
    pairs.push([v["id"], s]);
  }
  return { pairs, unreadable };
}

export function answerFor(
  obj: Record<string, unknown>,
  n: number,
): { supported: boolean[]; unreadable: number } | undefined {
  const raw = obj["verdicts"] === undefined ? [] : obj["verdicts"];
  if (!Array.isArray(raw) || raw.length !== n) return undefined;
  const { pairs, unreadable } = verdictPairs(raw);
  const byId = new Map(pairs);
  if (pairs.length !== n || byId.size !== n || !Array.from({ length: n }, (_, i) => i + 1).every((i) => byId.has(i)))
    return undefined;
  return { supported: Array.from({ length: n }, (_, i) => byId.get(i + 1)!), unreadable };
}

export function describeMismatch(obj: Record<string, unknown>, n: number): string {
  const raw = obj["verdicts"] === undefined ? [] : obj["verdicts"];
  if (!Array.isArray(raw)) return `\`verdicts\` was ${pyType(raw)}, not a list of ${n}`;
  const { pairs } = verdictPairs(raw);
  const byId = new Map(pairs);
  const missing = Array.from({ length: n }, (_, i) => i + 1).filter((i) => !byId.has(i));
  const ids = [...byId.keys()].toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  return `verdicts missing/misaligned for claim(s) ${missing.length ? pyList(missing) : "none"} (${raw.length} element(s), ${pairs.length} usable, ids ${pyList(ids)})`;
}

export function readAudit(text: string, n: number): { supported: boolean[]; unreadable: number } | { problem: string } {
  const objects = jsonObjects(text);
  if (!objects.length)
    return { problem: `no JSON object in the reply, which began ${pyRepr(Array.from(text).slice(0, 60).join(""))}` };
  const usable = objects.flatMap((o) => answerFor(o, n) ?? []);
  return usable.length ? usable.at(-1)! : { problem: describeMismatch(objects.at(-1)!, n) };
}

export function offThread(facts: unknown[], own: Set<string>, others: Set<string>): boolean[] {
  return facts.map((f) => {
    const ids = isObject(f) ? cited(f["sources"]) : [];
    return !ids.some((id) => own.has(id)) && ids.some((id) => others.has(id));
  });
}

export async function applyInstallment(
  store: ThreadStore,
  threadId: number,
  openNow: string[],
  installment: Installment,
  supported: boolean[],
  runId: number,
): Promise<Installment> {
  const whatsNew = whatsNewOf(installment);
  const kept = whatsNew.filter((_, i) => supported[i] === true);
  const citedIds = [...new Set(whatsNew.flatMap((f) => (isObject(f) ? cited(f["sources"]) : [])))].toSorted();
  const verified = { ...installment, whats_new: kept, cited_ids: citedIds };
  const open = new Set(openNow);
  for (const r of list(installment["resolved"])) {
    if (!isObject(r)) throw new Error(`thread ${threadId}: a resolved entry is not an object`);
    const question = typeof r["question"] === "string" ? r["question"] : "";
    if (open.has(question))
      await store.resolveQuestion(threadId, question, runId, typeof r["how"] === "string" ? r["how"] : "");
  }
  const fresh = list(installment["new_questions"]).filter((q): q is string => typeof q === "string");
  if (fresh.length && JSON.stringify(cleanQuestions(fresh, citedIds)) !== JSON.stringify(fresh))
    log.warn({
      stage: "threads",
      warning: "a new question cites an article id inline; the public ledger will suppress it",
      thread_id: threadId,
    });
  if (fresh.length) await store.addQuestions(threadId, fresh, runId);
  await store.setUpdateContent(threadId, runId, JSON.stringify(verified));
  return verified;
}

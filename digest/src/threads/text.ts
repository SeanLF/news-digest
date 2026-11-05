import { stripArticleIds } from "../contracts/leaks.js";

export interface Fact {
  fact?: unknown;
  sources?: unknown;
}

const tidy = (text: string): string => text.replace(/\s{2,}/g, " ").trim();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (id: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])${escape(id)}(?![\\p{L}\\p{N}_])`, "u");

export function cited(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((s) => (typeof s === "string" && s.trim() ? [s.trim()] : []));
}

export function scrubProse(raw: unknown, sources: unknown): string {
  const text = typeof raw === "string" ? tidy(stripArticleIds(raw)) : "";
  if (!text) return "";
  return cited(sources).some((s) => bounded(s).test(text)) ? "" : text;
}

export function cleanFact(fact: unknown): string {
  if (!fact || typeof fact !== "object" || Array.isArray(fact)) return "";
  const f = fact as Fact;
  return scrubProse(f.fact, f.sources);
}

export function cleanQuestions(questions: unknown, citedIds: unknown): string[] {
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((q) => (typeof q === "string" && (q = scrubProse(q, citedIds)) ? [q as string] : []));
}

export function deltaFromFacts(facts: unknown[], topN = 3): string {
  const out: string[] = [];
  for (const f of facts) {
    if (out.length >= topN) break;
    const t = cleanFact(f);
    if (t) out.push(t);
  }
  return out.join(" ");
}

export function whatsNew(content: string | null | undefined): unknown[] {
  if (!content) return [];
  try {
    const doc = JSON.parse(content) as unknown;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
    const w = (doc as { whats_new?: unknown }).whats_new;
    return Array.isArray(w) ? w : [];
  } catch {
    return [];
  }
}

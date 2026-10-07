// Scores a replayed stage against the run's own artifact (the reference: what production produced), as
// numbers a pre-registered rule can hold. Pure; replay-assert.ts applies them.
import type { Mode } from "./stage-replay.js";

type Scores = Record<string, number>;
interface Clusters { clusters: { article_ids: string[] }[] }
interface Selected { must_know: { cluster_index: number }[]; should_know: { cluster_index: number }[] }
interface Report { results: { article_ids: string[]; pass: boolean; headline: string }[] }
interface Attribution { stories: Record<string, { claims: { field: string; text: string; supported_by: string[]; differs: { article_id: string }[] }[] }> }

const jaccard = (a: Set<unknown>, b: Set<unknown>): number => (a.size + b.size === 0 ? 1 : [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size);

function pairs(c: Clusters): Set<string> {
  const s = new Set<string>();
  for (const { article_ids } of c.clusters) {
    const ids = article_ids.toSorted();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) s.add(`${ids[i]}|${ids[j]}`);
  }
  return s;
}

// keeps: share of the reference's co-clustered pairs the replay keeps; adds: pairs the reference lacks,
// as a share of the reference's (lumping).
export function scoreCluster(out: Clusters, ref: Clusters): Scores {
  const p = pairs(out), r = pairs(ref);
  const kept = [...r].filter((x) => p.has(x)).length;
  return { keeps: r.size ? kept / r.size : 1, adds: r.size ? (p.size - kept) / r.size : 0, clusters: out.clusters.length, refClusters: ref.clusters.length };
}

// On the same clusters (a SELECT replay reads the run's): agreement of the must-know set and of every pick.
export function scoreSelect(out: Selected, ref: Selected): Scores {
  const must = (s: Selected) => new Set(s.must_know.map((x) => x.cluster_index));
  const all = (s: Selected) => new Set([...s.must_know, ...s.should_know].map((x) => x.cluster_index));
  return { mustAgree: jaccard(must(out), must(ref)), pickedAgree: jaccard(all(out), all(ref)), must: out.must_know.length, picked: all(out).size };
}

// Per story (by its article ids): misses are stories the reference failed and the replay passed,
// extras the reverse; unmatched counts stories one side lacks.
const storyKey = (r: { article_ids: string[] }): string => r.article_ids.toSorted().join(",");
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.toSorted().join() === b.toSorted().join();

export interface CoherenceScores { stories: number; disagree: number; misses: number; extras: number; unmatched: number; missed: string[]; extra: string[] }
export function scoreCoherence(out: Report, ref: Report): CoherenceScores {
  const o = new Map(out.results.map((r) => [storyKey(r), r]));
  let disagree = 0, unmatched = 0;
  const missed: string[] = [], extra: string[] = [];
  for (const r of ref.results) {
    const x = o.get(storyKey(r));
    if (!x) { unmatched++; continue; }
    if (x.pass !== r.pass) disagree++;
    if (!r.pass && x.pass) missed.push(r.headline);
    if (r.pass && !x.pass) extra.push(r.headline);
  }
  const n = ref.results.length - unmatched;
  return { stories: n, disagree: n ? disagree / n : 0, misses: missed.length, extras: extra.length, unmatched, missed, extra };
}

// Per claim: whether the replay's supporting and differing articles are the same sets as the reference's.
export function scoreAttribute(out: Attribution, ref: Attribution): Scores {
  let claims = 0, identical = 0, differs = 0, refDiffers = 0;
  for (const [k, s] of Object.entries(ref.stories)) {
    const oc = new Map((out.stories[k]?.claims ?? []).map((c) => [`${c.field}\u0000${c.text}`, c]));
    for (const c of s.claims) {
      const x = oc.get(`${c.field}\u0000${c.text}`);
      claims++;
      refDiffers += c.differs.length;
      if (!x) continue;
      differs += x.differs.length;
      if (sameSet(x.supported_by, c.supported_by) && sameSet(x.differs.map((d) => d.article_id), c.differs.map((d) => d.article_id))) identical++;
    }
  }
  return { claims, identical: claims ? identical / claims : 1, differs, refDiffers };
}

// The scores a rule can bound, and for COHERENCE the headlines behind its misses and extras.
export function score(mode: Mode, out: unknown, ref: unknown): { scores: Scores; missed?: string[]; extra?: string[] } {
  if (mode === "cluster") return { scores: scoreCluster(out as Clusters, ref as Clusters) };
  if (mode === "select") return { scores: scoreSelect(out as Selected, ref as Selected) };
  if (mode === "attribute") return { scores: scoreAttribute(out as Attribution, ref as Attribution) };
  const { missed, extra, ...scores } = scoreCoherence(out as Report, ref as Report);
  return { scores, missed, extra };
}

// A pre-registered rule: bounds on named scores ({ misses: { max: 0 }, disagree: { max: 0.1 } }).
export type Rule = Record<string, { min?: number; max?: number }>;
export function breaches(scores: Scores, rule: Rule): string[] {
  const out: string[] = [];
  for (const [k, { min, max }] of Object.entries(rule)) {
    const v = scores[k];
    if (v === undefined) out.push(`${k}: no such score`);
    else if (min !== undefined && v < min) out.push(`${k} ${v} < ${min}`);
    else if (max !== undefined && v > max) out.push(`${k} ${v} > ${max}`);
  }
  return out;
}

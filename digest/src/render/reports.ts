import { decodeHTML } from "entities";
import { log } from "../log.js";
import { AGENCY_LABELS, AGENCY_RATINGS, BUCKET_ORDER, biasBucket, hasArticlePath, isSafeUrl, titleCase, type Bucket, type Source, type StoryClaim } from "./common.js";
import { repostKey } from "./resolve.js";

export type ReportBucket = Bucket | "u";
export const REPORT_BUCKET_ORDER: ReportBucket[] = [...BUCKET_ORDER, "u"];
// titles runs beside urls: each openable article's headline as its feed gave it.
export interface ReportMember { name: string; bias: string; urls: string[]; titles: string[]; ids: string[]; origin: boolean }
export interface Report { label: string; leaning: string; bucket: ReportBucket; wire: boolean; members: ReportMember[] }
export const SHARED_COPY = "Shared copy";

const GENERIC_HEADLINES = new Set(["live updates", "live", "what we know", "latest news", "news", "the latest", "explainer", "analysis"]);

function find(parent: number[], i: number): number {
  while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
  return i;
}
const agencyOf = (s: Source): string | null => {
  const raw = s.wire_agency?.trim().toLowerCase();
  return raw ? (AGENCY_LABELS[raw] ?? titleCase(raw)) : null;
};
const openable = (url: string) => isSafeUrl(url) && hasArticlePath(url);

// A story's sources as reports. Wire copy is its agency's report, rated as the agency is; identical
// headlines with no wire tag are one report whose origin is unknown; the rest is each outlet's own.
export function groupReports(sources: Source[]): { reports: Report[]; outlets: number } {
  const named = sources.filter((s) => s.name);
  const parent = named.map((_, i) => i);
  const firstBy = new Map<string, number>();
  const link = (key: string, i: number) => {
    const j = firstBy.get(key);
    if (j === undefined) firstBy.set(key, i);
    else parent[find(parent, i)] = find(parent, j);
  };
  const headlines = named.map((s) => {
    const h = repostKey(s.original_title ?? "", s.name ?? "");
    return h && !GENERIC_HEADLINES.has(h) ? h : null;
  });
  const agenciesBy = new Map<string, Set<string>>();
  named.forEach((s, i) => {
    const h = headlines[i], a = agencyOf(s);
    if (h && a) agenciesBy.set(h, (agenciesBy.get(h) ?? new Set()).add(a));
  });
  named.forEach((s, i) => {
    const agency = agencyOf(s);
    if (agency) link(`wire:${agency}`, i);
    const h = headlines[i];
    if (h && (agenciesBy.get(h)?.size ?? 0) <= 1) link(`headline:${h}`, i);
  });

  const components = new Map<number, number[]>();
  named.forEach((_, i) => components.set(find(parent, i), [...(components.get(find(parent, i)) ?? []), i]));
  const reports: Report[] = [];
  for (const idx of components.values()) {
    const members: ReportMember[] = [];
    for (const i of idx) {
      const s = named[i]!;
      let m = members.find((x) => x.name === s.name);
      if (!m) members.push((m = { name: s.name!, bias: s.bias ?? "", urls: [], titles: [], ids: [], origin: false }));
      if (s.url && openable(s.url)) {
        m.urls.push(s.url);
        m.titles.push(s.original_title?.trim() ?? "");
      }
      if (s.article_id) m.ids.push(s.article_id);
    }
    const shown = members.filter((m) => m.urls.length);
    if (!shown.length) continue;
    const agency = idx.map((i) => agencyOf(named[i]!)).find(Boolean) ?? null;
    if (agency) {
      for (const m of shown) m.origin = m.name.toLowerCase() === agency.toLowerCase() || idx.some((i) => named[i]!.name === m.name && named[i]!.wire && agencyOf(named[i]!) === agency);
      const rating = AGENCY_RATINGS[agency];
      reports.push({ label: agency, leaning: rating?.bias ?? "unrated", bucket: rating ? biasBucket(rating.bias) : "u", wire: true, members: [...shown.filter((m) => m.origin), ...shown.filter((m) => !m.origin)] });
    } else if (shown.length > 1) {
      reports.push({ label: SHARED_COPY, leaning: "unrated", bucket: "u", wire: false, members: shown });
    } else {
      const own = shown[0]!;
      own.origin = true;
      const existing = reports.find((r) => !r.wire && r.label === own.name);
      if (existing) {
        existing.members[0]!.urls.push(...own.urls);
        existing.members[0]!.titles.push(...own.titles);
        existing.members[0]!.ids.push(...own.ids);
      }
      else reports.push({ label: own.name, leaning: own.bias, bucket: biasBucket(own.bias), wire: false, members: [own] });
    }
  }
  if (named.length && !reports.length) log.warn({ stage: "render", warning: "every source dropped (no openable article link); the story ships with no source block", sources: named.length });
  const ordered = REPORT_BUCKET_ORDER.flatMap((b) => reports.filter((r) => r.bucket === b));
  return { reports: ordered, outlets: new Set(ordered.flatMap((r) => r.members.map((m) => m.name))).size };
}

// A rating as a reader says it; an unknown one is shown as it was written.
const LEANING: Record<string, string> = {
  "far-left": "Far left",
  left: "Left",
  "lean-left": "Lean left",
  center: "Centre",
  "lean-right": "Lean right",
  right: "Right",
  "far-right": "Far right",
  unrated: "Unrated",
};
export const leaningLabel = (leaning: string): string => LEANING[leaning] ?? leaning;
const LEANING_ORDER = Object.keys(LEANING);
const leaningRank = (l: string) => (LEANING_ORDER.includes(l) ? LEANING_ORDER.indexOf(l) : LEANING_ORDER.length);
type Row = ReturnType<typeof reportRows>[number];
// Rows under one heading per leaning, far left to far right, unrated and unknown ratings last. A
// carrier stays under the report it carried; its own leaning is the row's to show.
export function leaningGroups(rows: Row[]): { leaning: string; bucket: ReportBucket; rows: Row[] }[] {
  const groups: { leaning: string; bucket: ReportBucket; rows: Row[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  for (const r of rows) {
    if (!r.carrier) {
      current = groups.find((g) => g.leaning === r.leaning);
      if (!current) groups.push((current = { leaning: r.leaning, bucket: r.bucket, rows: [] }));
    }
    current?.rows.push(r);
  }
  return groups.toSorted((a, b) => leaningRank(a.leaning) - leaningRank(b.leaning));
}
export const REPORT_BUCKET_WORD: Record<ReportBucket, string> = { l: "left", c: "center", r: "right", u: "unrated" };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const countsLabel = (g: { reports: Report[]; outlets: number }) => `${plural(g.reports.length, "report")} · ${plural(g.outlets, "outlet")}`;
export function tally(reports: Report[]): [ReportBucket, number][] {
  return REPORT_BUCKET_ORDER.map((b) => [b, reports.filter((r) => r.bucket === b).length] as [ReportBucket, number]).filter(([, n]) => n);
}
// Rows as the sources table shows them: each report, then the outlets that carried it.
export interface ReportArticle { url: string; title: string }
// A feed's headline names its outlet at the end ("Five men held - Reuters"); the row already does.
// Some feeds send it HTML-escaped ("Yemen&#x27;s"); the renderers escape it again on output.
function articleTitle(title: string, outlet: string, url: string): string {
  const t = decodeHTML(title).replace(/\s+[-–—|]\s+([^-–—|]+)$/, (m, tail: string) => (tail.trim().toLowerCase() === outlet.toLowerCase() ? "" : m)).trim();
  return t || new URL(url).hostname.replace(/^www\./, "");
}
const articles = (m: ReportMember, outlet: string): ReportArticle[] => m.urls.map((url, i) => ({ url, title: articleTitle(m.titles[i] ?? "", outlet, url) }));
const sameWords = (s: string) => s.toLowerCase().replaceAll(/[^\p{L}\p{N}]+/gu, "");
// A carrier is a republisher when its report has a known origin, and only one outlet among several
// that ran shared copy when not. sameCopy: its one article runs the origin's headline, so the row
// can link the outlet instead of repeating the headline.
export function reportRows(reports: Report[], claims: StoryClaim[] = []): { carrier: boolean; republished: boolean; sameCopy: boolean; name: string; wire: boolean; leaning: string; bucket: ReportBucket; articles: ReportArticle[]; backs: string[] }[] {
  return reports.flatMap((r) => {
    const origin = r.members.find((m) => m.origin);
    const own = origin ? articles(origin, origin.name) : [];
    const heads = new Set(own.map((a) => sameWords(a.title)));
    const ids = new Set(r.members.flatMap((m) => m.ids));
    const backs = [...new Set(claims.filter((c) => c.supported_by.some((id) => ids.has(id))).map((c) => c.text))];
    return [
      { carrier: false, republished: false, sameCopy: false, name: r.label, wire: r.wire, leaning: r.leaning, bucket: r.bucket, articles: own, backs },
      ...r.members
        .filter((m) => !m.origin)
        .map((m) => {
          const arts = articles(m, m.name);
          const sameCopy = origin !== undefined && arts.length === 1 && heads.has(sameWords(arts[0]!.title));
          return { carrier: true, republished: origin !== undefined, sameCopy, name: m.name, wire: false, leaning: m.bias, bucket: m.bias ? biasBucket(m.bias) : ("u" as const), articles: arts, backs: [] };
        }),
    ];
  });
}

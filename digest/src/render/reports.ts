import { log } from "../log.js";
import { AGENCY_LABELS, AGENCY_RATINGS, BUCKET_ORDER, biasBucket, hasArticlePath, isSafeUrl, titleCase, type Bucket, type Source } from "./common.js";
import { repostKey } from "./resolve.js";

export type ReportBucket = Bucket | "u";
export const REPORT_BUCKET_ORDER: ReportBucket[] = [...BUCKET_ORDER, "u"];
export interface ReportMember { name: string; bias: string; urls: string[]; origin: boolean }
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
      if (!m) members.push((m = { name: s.name!, bias: s.bias ?? "", urls: [], origin: false }));
      if (s.url && openable(s.url)) m.urls.push(s.url);
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
      if (existing) existing.members[0]!.urls.push(...own.urls);
      else reports.push({ label: own.name, leaning: own.bias, bucket: biasBucket(own.bias), wire: false, members: [own] });
    }
  }
  if (named.length && !reports.length) log.warn({ stage: "render", warning: "every source dropped (no openable article link); the story ships with no source block", sources: named.length });
  const ordered = REPORT_BUCKET_ORDER.flatMap((b) => reports.filter((r) => r.bucket === b));
  return { reports: ordered, outlets: new Set(ordered.flatMap((r) => r.members.map((m) => m.name))).size };
}

export const REPORT_BUCKET_WORD: Record<ReportBucket, string> = { l: "left", c: "center", r: "right", u: "unrated" };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const countsLabel = (g: { reports: Report[]; outlets: number }) => `${plural(g.reports.length, "report")} · ${plural(g.outlets, "outlet")}`;
export function tally(reports: Report[]): [ReportBucket, number][] {
  return REPORT_BUCKET_ORDER.map((b) => [b, reports.filter((r) => r.bucket === b).length] as [ReportBucket, number]).filter(([, n]) => n);
}
// Rows as the sources table shows them: each report, then the outlets that carried it.
export function reportRows(reports: Report[]): { carrier: boolean; name: string; wire: boolean; leaning: string; urls: string[] }[] {
  return reports.flatMap((r) => {
    const origin = r.members.find((m) => m.origin);
    return [
      { carrier: false, name: r.label, wire: r.wire, leaning: r.leaning, urls: origin?.urls ?? [] },
      ...r.members.filter((m) => !m.origin).map((m) => ({ carrier: true, name: m.name, wire: false, leaning: m.bias, urls: m.urls })),
    ];
  });
}

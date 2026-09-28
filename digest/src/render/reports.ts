import { AGENCY_LABELS, BUCKET_ORDER, biasBucket, hasArticlePath, isSafeUrl, titleCase, type Bucket, type Source } from "./common.js";
import { repostKey } from "./resolve.js";

export type ReportBucket = Bucket | "w";
export const REPORT_BUCKET_ORDER: ReportBucket[] = [...BUCKET_ORDER, "w"];
export interface ReportMember { name: string; bias: string; urls: string[]; origin: boolean }
export interface Report { label: string; leaning: string; bucket: ReportBucket; members: ReportMember[] }

const GENERIC_HEADLINES = new Set(["live updates", "live", "what we know", "latest news", "news", "the latest", "explainer", "analysis"]);

function find(parent: number[], i: number): number {
  while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
  return i;
}
function union(parent: number[], a: number, b: number): void {
  parent[find(parent, a)] = find(parent, b);
}
const agencyKey = (s: Source) => s.wire_agency?.trim().toLowerCase() || null;
const agencyLabel = (agency: string) => AGENCY_LABELS[agency] ?? titleCase(agency);
const openable = (url: string) => isSafeUrl(url) && hasArticlePath(url);

// A story's sources as reports: wire copy joins its agency's report, identical headlines join each
// other, and everything else is its outlet's own reporting.
export function groupReports(sources: Source[]): { reports: Report[]; outlets: number } {
  const named = sources.filter((s) => s.name);
  const parent = named.map((_, i) => i);
  const firstBy = new Map<string, number>();
  const link = (key: string | null, i: number) => {
    if (!key) return;
    const j = firstBy.get(key);
    if (j === undefined) firstBy.set(key, i);
    else union(parent, i, j);
  };
  named.forEach((s, i) => {
    const agency = agencyKey(s);
    link(agency && `wire:${agency}`, i);
    const headline = repostKey(s.original_title ?? "", s.name ?? "");
    link(headline && !GENERIC_HEADLINES.has(headline) ? `headline:${headline}` : null, i);
  });
  const size = new Map<number, number>();
  named.forEach((_, i) => size.set(find(parent, i), (size.get(find(parent, i)) ?? 0) + 1));
  named.forEach((s, i) => {
    if (size.get(find(parent, i)) === 1 && !agencyKey(s)) link(`outlet:${s.name}`, i);
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
    const agency = idx.map((i) => agencyKey(named[i]!)).find(Boolean) ?? null;
    let report: Report;
    if (agency) {
      const label = agencyLabel(agency);
      for (const m of members) m.origin = m.name.toLowerCase() === label.toLowerCase() || idx.some((i) => named[i]!.name === m.name && named[i]!.wire);
      report = { label, leaning: "wire", bucket: "w", members };
    } else {
      members[0]!.origin = true;
      report = { label: members[0]!.name, leaning: members[0]!.bias, bucket: biasBucket(members[0]!.bias), members };
    }
    report.members = [...report.members.filter((m) => m.origin), ...report.members.filter((m) => !m.origin)].filter((m) => m.urls.length);
    if (report.members.length) reports.push(report);
  }
  const ordered = REPORT_BUCKET_ORDER.flatMap((b) => reports.filter((r) => r.bucket === b));
  return { reports: ordered, outlets: new Set(ordered.flatMap((r) => r.members.map((m) => m.name))).size };
}

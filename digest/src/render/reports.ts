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
  const headlines = named.map((s) => {
    const h = repostKey(s.original_title ?? "", s.name ?? "");
    return h && !GENERIC_HEADLINES.has(h) ? h : null;
  });
  const agenciesBy = new Map<string, Set<string>>();
  named.forEach((s, i) => {
    const h = headlines[i], a = agencyKey(s);
    if (h && a) agenciesBy.set(h, (agenciesBy.get(h) ?? new Set()).add(a));
  });
  named.forEach((s, i) => {
    const agency = agencyKey(s);
    link(agency && `wire:${agency}`, i);
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
    const agency = idx.map((i) => agencyKey(named[i]!)).find(Boolean) ?? null;
    if (agency) {
      const label = agencyLabel(agency);
      for (const m of shown) m.origin = m.name.toLowerCase() === label.toLowerCase() || idx.some((i) => named[i]!.name === m.name && named[i]!.wire && agencyKey(named[i]!) === agency);
      reports.push({ label, leaning: "wire", bucket: "w", members: [...shown.filter((m) => m.origin), ...shown.filter((m) => !m.origin)] });
      continue;
    }
    const origin = shown[0]!;
    origin.origin = true;
    const own = reports.find((r) => r.bucket !== "w" && r.label === origin.name);
    if (own) {
      for (const m of shown) {
        const same = own.members.find((x) => x.name === m.name);
        if (same) same.urls.push(...m.urls);
        else own.members.push({ ...m, origin: false });
      }
    } else reports.push({ label: origin.name, leaning: origin.bias, bucket: biasBucket(origin.bias), members: shown });
  }
  const ordered = REPORT_BUCKET_ORDER.flatMap((b) => reports.filter((r) => r.bucket === b));
  return { reports: ordered, outlets: new Set(ordered.flatMap((r) => r.members.map((m) => m.name))).size };
}

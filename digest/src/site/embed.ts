import { decodeHTML } from "entities";
import { AGENCY_RATINGS } from "../render/common.js";
import type { IssueRowData, SiteData } from "./data.js";
import { type Bucket, type CatalogueEntry, knownBucket } from "./sources.js";

// The lead story of a stored issue, read from the HTML web.ts rendered, so the embed shows what the
// issue page shows. Text fields are the stored, already-escaped HTML text.

export type Leaning = Bucket | "u";

export interface Lead {
  slug: string;
  headline: string;
  // The thread page's id when the eyebrow links one; day is the thread's day in this issue.
  thread: { id: number | null; day: number } | undefined;
  why: string;
  varies: { outlet: string; angle: string }[];
  // The bias bar's segments as stored, and its two labels: "5 reports · 5 outlets", "2 left · 2 center · 1 right".
  segments: { leaning: Leaning; n: number }[];
  counts: string;
  split: string;
}

export interface StoredIssue {
  // The issue's own inline stylesheets, which style its markup.
  styles: string[];
  // The masthead's brand markup, e.g. "Sean's Daily <b>Digest</b>".
  brand: string | undefined;
  lead: Lead | undefined;
}

const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const LEAD = /<article\b[^>]*\bclass="first"[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/article>/;
const HEAD = /<h3\b[^>]*>([\s\S]*?)<\/h3>/;
const EYEBROW = /<p class="eyebrow">([\s\S]*?)<\/p>/;
const WHY = /<div class="why">[\s\S]*?<p>([\s\S]*?)<\/p><\/div>/;
const VARIES = /<div class="varies">([\s\S]*?)<\/div>/;
const ANGLE = /<p><b>([\s\S]*?):<\/b>\s*([\s\S]*?)<\/p>/g;
const SPREAD = /<summary class="spread">([\s\S]*?)<\/summary>/;
const SEG = /<span class="seg (l|c|r|u)" style="flex:(\d+)">/g;

const asLeaning = (b: string | undefined): Leaning => (b === "l" || b === "c" || b === "r" ? b : "u");
const text = (html: string): string => html.replace(/<[^>]+>/g, "").trim();

export function readIssue(html: string): StoredIssue {
  const styles = [...html.matchAll(STYLE)].map((m) => m[1]!);
  const brand = /<h1 class="brand">([\s\S]*?)<\/h1>/.exec(html)?.[1]?.trim();
  return { styles, brand, lead: readLead(html) };
}

function readLead(html: string): Lead | undefined {
  const m = LEAD.exec(html);
  const slug = m?.[1], body = m?.[2];
  if (slug === undefined || body === undefined) return undefined;
  const headline = text((HEAD.exec(body)?.[1] ?? "").replace(/<a class="anchor"[\s\S]*?<\/a>/g, ""));
  if (!headline) return undefined;
  const eyebrow = EYEBROW.exec(body)?.[1];
  const day = eyebrow ? /day (\d+)/.exec(eyebrow)?.[1] : undefined;
  const threadId = eyebrow ? /href="[^"]*\/thread\/(\d+)"/.exec(eyebrow)?.[1] : undefined;
  const spread = SPREAD.exec(body)?.[1] ?? "";
  return {
    slug,
    headline,
    thread: day ? { id: threadId ? Number(threadId) : null, day: Number(day) } : undefined,
    why: text(WHY.exec(body)?.[1] ?? ""),
    varies: [...(VARIES.exec(body)?.[1] ?? "").matchAll(ANGLE)].map((a) => ({ outlet: text(a[1]!), angle: text(a[2]!) })),
    segments: [...spread.matchAll(SEG)].map((s) => ({ leaning: asLeaning(s[1]), n: Number(s[2]) })),
    counts: text(/<span class="n">([\s\S]*?)<\/span>/.exec(spread)?.[1] ?? ""),
    split: text(/<span class="vh">([\s\S]*?)<\/span>/.exec(spread)?.[1] ?? "").replace(/^·\s*/, ""),
  };
}

// An outlet's leaning by the name the issue prints: resolve names an angle after the catalogue entry
// or, for wire copy, the agency, so those are the two places to look. Anything else is unrated.
export function leaningOf(catalogue: CatalogueEntry[]): (outlet: string) => Leaning {
  const byName = new Map<string, Leaning>();
  for (const [name, r] of Object.entries(AGENCY_RATINGS)) byName.set(name.toLowerCase(), knownBucket(r.bias) ?? "u");
  for (const s of catalogue) byName.set(s.name.toLowerCase(), knownBucket(s.bias) ?? "u");
  return (outlet) => byName.get(decodeHTML(outlet).trim().toLowerCase()) ?? "u";
}

// How far back the embed looks for an issue with a lead: an issue without one (a pre-redesign page,
// a day with no must-know) falls through to the one before.
export const LOOKBACK = 7;

// The newest issue with a lead story, with its archive row (number and story counts).
export async function latestLead(data: SiteData): Promise<{ row: IssueRowData; issue: StoredIssue & { lead: Lead } } | undefined> {
  for (const row of await data.archive({ limit: LOOKBACK })) {
    const stored = await data.issue(row.date);
    const issue = stored && readIssue(stored.html);
    if (issue?.lead) return { row, issue: { ...issue, lead: issue.lead } };
  }
  return undefined;
}

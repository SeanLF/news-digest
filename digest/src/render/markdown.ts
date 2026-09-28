import { isSafeUrl, type RenderInput, type Story, type StoryClaim } from "./common.js";
import { countsLabel, groupReports, REPORT_BUCKET_WORD, reportRows, tally } from "./reports.js";

// The issue as Markdown, for agents: the body the site serves under its title line (`.md`, Accept:
// text/markdown). Written from the selections the web issue is rendered from, never from its HTML, and
// held to the document the site's HTML converter made of that page (markdown.test.ts).

// Text as Markdown reads it literally: \ * _ ` [ ] anywhere, a "<" that would open a tag, and a line
// start that would open a block (heading, quote, list item, ordered item, setext rule).
function text(s: string): string {
  let out = s.replaceAll(/[\\*_`[\]]/g, (c) => `\\${c}`).replaceAll(/<(?=[!?/A-Za-z])/g, "\\<");
  out = out.replace(/^(\s*)([#>=~]|[-+](?=\s)|\d+(?=[.)]\s))/, (_m, sp: string, lead: string) => (/^\d/.test(lead) ? `${sp}${lead}\\` : `${sp}\\${lead}`));
  return out.trim();
}
const cell = (s: string) => text(s).replaceAll("|", "\\|").replaceAll(/\s+/g, " ");
const href = (url: string) => url.replaceAll(/[()]/g, (c) => `\\${c}`).replaceAll(" ", "%20");
const link = (label: string, url: string) => `[${label}](${href(url)})`;

function sources(g: ReturnType<typeof groupReports>, claims: StoryClaim[] = []): string[] {
  if (!g.reports.length) return [];
  const backsCol = claims.length > 0;
  const rows = reportRows(g.reports, claims).map((r) => {
    const name = r.carrier ? `↳ ${r.name}` : `${r.name}${r.wire ? " · wire" : ""}`;
    return `| ${cell(name)} | ${cell(r.leaning)} |${backsCol ? ` ${cell(r.backs.join("; "))} |` : ""} ${r.urls.map((u, i) => link(String(i + 1), u)).join(" ")} |`;
  });
  const hidden = tally(g.reports).map(([b, n]) => `${n} ${REPORT_BUCKET_WORD[b]}`).join(" · ");
  const head = backsCol ? ["| Report | Leaning | What it backs | Articles |", "| --- | --- | --- | --- |"] : ["| Report | Leaning | Articles |", "| --- | --- | --- |"];
  return [`${countsLabel(g)} · ${hidden}`, [...head, ...rows].join("\n")];
}

function story(a: Story, brief: boolean): string[] {
  const out = [`### ${text(a.headline ?? "")}`];
  const thread = a.thread ?? {};
  if ((thread.day ?? 0) >= 2) out.push(thread.url ? link(`Ongoing · day ${thread.day} ↗`, thread.url) : `Ongoing · day ${thread.day}`);
  // A continuing thread's delta, today's verified facts, replaces the summary.
  const body = (thread.delta ?? "").trim() || (a.summary ?? "");
  if (body.trim()) out.push(text(body));
  if (!brief) {
    const why = a.why_it_matters ?? "";
    if (why.trim()) out.push("**Why it matters**", text(why));
    const varies = a.reporting_varies ?? [];
    if (varies.length) out.push("**How reporting varies**", ...varies.map((rv) => `**${text(`${rv.source ?? ""}:`)}** ${text(rv.angle ?? "")}`));
  }
  out.push(...sources(groupReports(a.sources), a.claims ?? []));
  return out;
}

export function renderMarkdown({ selections, env }: RenderInput): string {
  const assessors = env.archiveUrl && isSafeUrl(env.archiveUrl) ? link("independent media assessors", `${env.archiveUrl}/sources`) : "independent media assessors";
  const blocks = [
    `**AI-written** Written by Claude, an assistant that can make mistakes - verify anything important against the linked sources. Political leanings from ${assessors}.`,
    "## Must Know",
    ...selections.must_know.flatMap((a) => story(a, false)),
    "## Should Know",
    ...selections.should_know.flatMap((a) => story(a, true)),
  ];
  return blocks.join("\n\n");
}

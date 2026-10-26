import { htmlEscape as esc } from "escape-goat";
import { transform } from "lightningcss";
import { codePoints, dates, isSafeUrl, readingTime, slugger, storyCounts, type RenderInput, type Story, type StoryClaim } from "./common.js";
import { countsLabel, groupReports, leaningGroups, leaningLabel, REPORT_BUCKET_WORD, reportRows, tally } from "./reports.js";

// The web issue, ported from newsroom/src/render.py (render_digest, then replace_placeholders).

function sourcesBlock(g: ReturnType<typeof groupReports>, claims: StoryClaim[] = []): string {
  if (!g.reports.length) return "";
  const counts = tally(g.reports);
  const segs = counts.map(([b, n]) => `<span class="seg ${b}" style="flex:${n}"></span>`).join("");
  const spread = `<span class="n">${countsLabel(g)}</span><span class="vh"> · ${counts.map(([b, n]) => `${n} ${REPORT_BUCKET_WORD[b]}`).join(" · ")}</span>`;
  const backsCol = claims.length > 0;
  const row = (r: ReturnType<typeof reportRows>[number]) => {
    // Each article by its own headline, one or several alike, so the link says where it goes; a
    // republisher running the origin's headline links by its name instead of repeating it.
    const arts = r.articles.length && !r.sameCopy ? `<ul class="arts">${r.articles.map((a) => `<li><a href="${esc(a.url)}">${esc(a.title)}</a></li>`).join("")}</ul>` : "";
    const tag = r.carrier ? ` · ${esc(leaningLabel(r.leaning))}` : r.wire ? " · wire" : "";
    const label = r.sameCopy ? `<a class="out" href="${esc(r.articles[0]!.url)}">${esc(r.name)}</a>` : esc(r.name);
    const name = `${r.republished ? '<span class="rp">Republished by </span>' : ""}${label}${tag ? `<span class="via">${tag}</span>` : ""}`;
    // The hidden dash is for the Markdown converter and screen readers; the layout separates it by eye.
    const backs = backsCol && r.backs.length ? `<span class="bk"><span class="vh"> — </span><span class="bk-k">Backs: </span>${esc(r.backs.join("; "))}</span>` : "";
    return `<li${r.carrier ? ' class="carrier"' : ""}><span class="nm">${name}</span>${backs}${arts}</li>`;
  };
  const groups = leaningGroups(reportRows(g.reports, claims))
    .map((gr) => `<div class="src-grp ${gr.bucket}"><p class="src-gh">${esc(leaningLabel(gr.leaning))}</p><ul class="src-list">${gr.rows.map(row).join("")}</ul></div>`)
    .join("");
  return (
    `<details class="srcbox"><summary class="spread"><span class="biasbar" aria-hidden="true">${segs}</span>` +
    `<span class="spread-label">${spread}</span></summary>` +
    `<div class="src-groups">${groups}</div></details>`
  );
}

function article(a: Story, slug: string, { brief = false, first = false } = {}): string {
  const raw = a.headline ?? "";
  const headline = esc(raw);
  const why = esc(a.why_it_matters ?? "");
  const anchor = `<a class="anchor" href="#${slug}" aria-label="Copy link: ${esc(codePoints(raw, 50))}"></a>`;
  const thread = a.thread ?? {};
  let eyebrow = "";
  if ((thread.day ?? 0) >= 2) {
    const label = `<span class="loc">Ongoing</span> · day ${thread.day}`;
    eyebrow = thread.url ? `<p class="eyebrow"><a href="${esc(thread.url)}" aria-label="Ongoing · day ${thread.day} ↗ how this story developed">${label} ↗</a></p>` : `<p class="eyebrow">${label}</p>`;
  }
  // A continuing thread's delta, today's verified facts, replaces the summary.
  const delta = (thread.delta ?? "").trim();
  const body = delta ? esc(delta) : esc(a.summary ?? "");
  const sources = sourcesBlock(groupReports(a.sources), a.claims ?? []);
  if (brief) return [`<article class="brief" id="${slug}">`, `<h3>${headline}${anchor}</h3>`, ...(eyebrow ? [eyebrow] : []), `<p class="summary">${body}</p>`, sources, "</article>"].join("\n");
  const parts = [`<article${first ? ' class="first"' : ""} id="${slug}">`, `<h3 class="head">${headline}${anchor}</h3>`, ...(eyebrow ? [eyebrow] : []), `<p class="lede">${body}</p>`];
  if (why.trim()) parts.push(`<div class="why"><span class="lbl">Why it matters</span><p>${why}</p></div>`);
  const varies = a.reporting_varies ?? [];
  if (varies.length) parts.push(`<div class="varies"><span class="lbl">How reporting varies</span>${varies.map((rv) => `<p><b>${esc(rv.source ?? "")}:</b> ${esc(rv.angle ?? "")}</p>`).join("")}</div>`);
  parts.push(sources, "</article>");
  return parts.join("\n");
}

// Every placeholder replaced as a literal, never as a pattern: editorial text carries "$".
const put = (s: string, placeholder: string, value: string) => s.replaceAll(placeholder, () => value);
const strip = (s: string, re: RegExp, value = "") => s.replaceAll(re, value);
const reEscape = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
// An unconfigured footer-nav link goes with one adjacent " · ", whichever side it is on.
function stripNavLink(content: string, placeholder: string, text: string): string {
  const link = `<a href="\\{\\{${placeholder}\\}\\}">${reEscape(text)}</a>`;
  let c = strip(content, new RegExp(`${link}\\s*·\\s*`, "g"));
  c = strip(c, new RegExp(`\\s*·\\s*${link}`, "g"));
  return strip(c, new RegExp(link, "g"));
}

// The oldest engines the Python's stylesheet already served. Without targets lightningcss assumes
// every feature and rewrites `min-width` media queries into range syntax, which Safari before 16.4
// reads as false.
const v = (major: number) => major << 16;
export const CSS_TARGETS = { safari: v(15), ios_saf: v(15), chrome: v(100), edge: v(100), firefox: v(91) };

export function minifyCss(css: string): string {
  return transform({ code: Buffer.from(css), minify: true, filename: "digest.css", targets: CSS_TARGETS }).code.toString();
}

export function renderWeb({ selections, now, issueNo, env, assets }: RenderInput): string {
  const slug = slugger();
  const mustKnow = selections.must_know.map((a, i) => article(a, slug(a.headline ?? ""), { first: i === 0 })).join("\n");
  const shouldKnow = selections.should_know.map((a) => article(a, slug(a.headline ?? ""), { brief: true })).join("\n");
  let c = put(put(assets.template, "{{MUST_KNOW}}", mustKnow), "{{SHOULD_KNOW}}", shouldKnow);

  for (const p of ["{{DIGEST_NAME}}", "{{DATE}}", "{{STYLES}}"]) if (!c.includes(p)) throw new Error(`Missing placeholder ${p} in digest`);
  const d = dates(now);
  c = put(c, "{{STYLES}}", minifyCss(`${assets.tokens}\n${assets.styles}`));
  c = put(c, "{{DIGEST_NAME}}", esc(env.digestName ?? "News Digest"));
  c = put(c, "{{DATE}}", d.long);
  c = put(c, "{{DATE_ISO}}", d.iso);
  c = put(c, "{{ISSUE_LABEL}}", issueNo === null ? "" : `No. ${issueNo}<br>`);
  c = put(c, "{{FILED_TIME}}", d.filed);
  c = put(c, "{{READING_TIME}}", readingTime(selections));
  c = put(c, "{{STORY_COUNT}}", storyCounts(selections));
  c = put(c, "{{GENERATED_AT}}", d.generated);
  c = put(c, "{{PREHEADER}}", esc(selections.preheader ?? ""));

  const notCovered = selections.not_covered_blurb;
  if (typeof notCovered === "string" && notCovered.trim()) c = put(c, "{{NOT_COVERED}}", `Not covered today: ${esc(notCovered.trim())}`);
  else c = strip(c, /\s*<p class="not-covered">\{\{NOT_COVERED\}\}<\/p>/g);

  const { authorName, authorUrl, archiveUrl, digestDomain } = env;
  if (authorName && authorUrl && isSafeUrl(authorUrl)) c = put(c, "{{AUTHOR_PLUG}}", `Made by <a href="${esc(authorUrl)}">${esc(authorName)}</a>`);
  else if (authorName) c = put(c, "{{AUTHOR_PLUG}}", `Made by ${esc(authorName)}`);
  else c = strip(c, /\s*<p class="footer-meta">\{\{AUTHOR_PLUG\}\}<\/p>/g);

  if (digestDomain) {
    c = put(c, "{{HOMEPAGE_URL}}", `https://${digestDomain}/issues/${d.iso}`);
    c = put(c, "{{SUBSCRIBE_URL}}", `https://${digestDomain}/#subscribe`);
  } else {
    c = stripNavLink(c, "SUBSCRIBE_URL", "Subscribe");
    c = put(c, "{{HOMEPAGE_URL}}", "");
  }

  if (archiveUrl && isSafeUrl(archiveUrl)) c = put(c, "{{ARCHIVE_URL}}", esc(archiveUrl));
  else {
    c = strip(c, /<a href="\{\{ARCHIVE_URL\}\}[^"]*">[^<]+<\/a> · /g);
    c = strip(c, /<a href="\{\{ARCHIVE_URL\}\}\/sources">([^<]+)<\/a>/g, "$1");
    c = put(c, "{{ARCHIVE_URL}}", "");
  }

  if (authorUrl && isSafeUrl(authorUrl)) c = put(c, "{{PRIVACY_URL}}", esc(`${authorUrl.replace(/\/+$/, "")}/privacy`));
  else c = stripNavLink(c, "PRIVACY_URL", "Privacy");

  // A placeholder left unfilled would ship blank to readers. The stylesheet's braces, Resend's
  // per-recipient {{{…}}} merge tags and editorial text quoting {{ user.name }} are not placeholders.
  const scan = c.replace(/<style>[\s\S]*?<\/style>/g, "").replaceAll(/\{\{\{[^{}]+\}\}\}/g, "");
  const leftover = /\{\{[A-Z][A-Z0-9_]*\}\}/.exec(scan);
  if (leftover) throw new Error(`Unfilled placeholder in rendered digest: ${leftover[0]}`);
  return c;
}

import { fontFace } from "../assets.js";
import { baseUrl } from "../config.js";
import type { IssueRowData } from "../data.js";
import type { Lead, Leaning, StoredIssue } from "../embed.js";
import { brandHtml, escapeHtml } from "../text.js";
import { type PageCtx, style } from "./chrome.js";

// /embed/lead: the newest issue's lead story as a card another site frames (seanfloyd.dev's
// homepage). It wears the issue's own stylesheet, so it follows the digest's design; the rules here
// only fit it to the frame. It fills whatever box it is given and clips what runs past the bottom.

// Every size is in rem off one root that tracks the frame's width, so the card reads the same in a
// 360, 680 or 1300 wide frame: 16px at 680, clamped so a phone stays legible and a wall stays sane.
const EMBED_CSS = `html{font-size:clamp(14px,2.35vw,32px)}
html,body{height:100%;overflow:hidden}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);font-size:1rem;line-height:1.5}
.e{padding:1.25rem 1.5rem}
.e article{max-width:none}
.e-mast{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.25rem .75rem;border-bottom:1px solid var(--ink);padding-bottom:.625rem;margin-bottom:1rem}
.e-mast .brand{font-size:1.375rem;margin:0}
.e-issue{font-family:var(--mono);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0;white-space:nowrap}
.e .section{gap:.75rem;margin-bottom:.875rem}
.e .section .num,.e .section .name,.e .eyebrow,.e .lbl{font-size:.75rem}
.e .head{font-size:1.375rem;margin-bottom:.5rem}
.e .head a{color:inherit;text-decoration:none}
.e .head a:hover{text-decoration:underline}
.e .why,.e .varies{margin:.75rem 0}
.e .why{padding-left:1rem}
.e .varies p{margin:.375rem 0}
.dot{display:inline-block;width:.5rem;height:.5rem;border-radius:50%;margin-right:.375rem;vertical-align:.06em;background:var(--bias-c)}
.dot.l{background:var(--bias-l)}.dot.r{background:var(--bias-r)}.dot.u{background:transparent;box-shadow:inset 0 0 0 1.5px var(--bias-c)}
.e-spread{display:flex;flex-wrap:wrap;align-items:center;gap:.375rem .625rem;font-family:var(--mono);font-size:.75rem;color:var(--muted);margin:.75rem 0 0}
.e-spread .biasbar{width:7.5rem;height:.25rem}`;

const LEANING_WORD: Record<Leaning, string> = { l: "left", c: "center", r: "right", u: "unrated" };

function head(ctx: PageCtx, title: string, canonical: string, styles: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="canonical" href="${canonical}">
${[fontFace(ctx.assets.fontUrl), ...styles, EMBED_CSS].map(style).join("\n")}
</head>`;
}

function story(lead: Lead, issueUrl: string, base: string, leaning: (outlet: string) => Leaning): string {
  const parts = [`<h3 class="head"><a href="${issueUrl}#${lead.slug}" target="_top">${lead.headline}</a></h3>`];
  const t = lead.thread;
  if (t && t.day >= 2) {
    const label = `<span class="loc">Ongoing</span> · day ${t.day}`;
    parts.push(t.id === null ? `<p class="eyebrow">${label}</p>` : `<p class="eyebrow"><a href="${base}/thread/${t.id}" target="_top">${label} ↗</a></p>`);
  }
  if (lead.why) parts.push(`<div class="why"><span class="lbl">Why it matters</span><p>${lead.why}</p></div>`);
  const varies = lead.varies.slice(0, 3);
  if (varies.length) {
    const rows = varies.map((v) => {
      const l = leaning(v.outlet);
      return `<p><span class="dot ${l}" aria-hidden="true"></span><b>${v.outlet}<span class="vh"> (${LEANING_WORD[l]})</span>:</b> ${v.angle}</p>`;
    });
    parts.push(`<div class="varies"><span class="lbl">How reporting varies</span>${rows.join("")}</div>`);
  }
  if (lead.segments.length) {
    const segs = lead.segments.map((s) => `<span class="seg ${s.leaning}" style="flex:${s.n}"></span>`).join("");
    parts.push(`<p class="e-spread"><span class="biasbar" aria-hidden="true">${segs}</span><span>${[lead.counts, lead.split].filter(Boolean).join(" · ")}</span></p>`);
  }
  return `<article class="first">${parts.join("\n")}</article>`;
}

export function embedLeadPage(ctx: PageCtx, row: IssueRowData, issue: StoredIssue & { lead: Lead }, leaning: (outlet: string) => Leaning): string {
  const base = baseUrl(ctx.cfg);
  const issueUrl = `${base}/issues/${row.date}`;
  const brand = issue.brand ?? escapeHtml(ctx.cfg.digestName);
  const stories = row.must + row.should;
  return `${head(ctx, `${issue.lead.headline} — ${escapeHtml(ctx.cfg.digestName)}`, issueUrl, issue.styles)}
<body>
<div class="e">
<header class="e-mast"><p class="brand">${brand}</p><p class="e-issue">Issue ${row.issueNo} · ${stories} ${stories === 1 ? "story" : "stories"}</p></header>
<div class="section"><span class="num" aria-hidden="true">01</span><h2 class="name">Must Know</h2><span class="rule" aria-hidden="true"></span></div>
${story(issue.lead, issueUrl, base, leaning)}
</div>
</body>
</html>`;
}

// No issue with a lead yet: the frame still gets a card, pointing at the archive.
export function embedEmptyPage(ctx: PageCtx, tokensCss: string): string {
  const base = baseUrl(ctx.cfg);
  return `${head(ctx, escapeHtml(ctx.cfg.digestName), `${base}/`, [tokensCss])}
<body>
<div class="e">
<header class="e-mast"><p class="brand">${brandHtml(ctx.cfg.digestName)}</p></header>
<p>No issue yet. <a href="${base}/" target="_top">The archive</a></p>
</div>
</body>
</html>`;
}

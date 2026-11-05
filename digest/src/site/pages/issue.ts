import { fontFace } from "../assets.js";
import { ogImageUrl } from "../config.js";
import { log } from "../../log.js";
import { hiddenPointer, markdownLinkTag } from "../markdown.js";
import { escapeHtml } from "../text.js";
import {
  digestNavCss,
  proxyTranslateHideScript,
  railCss,
  railJs,
  reducedMotionCss,
  skipLinkCss,
  toggleJs,
} from "./blobs.js";
import { NO_FLASH_JS, type PageCtx, TOGGLE_BTN, ogImageTags, topbar, translatePill } from "./chrome.js";

export const NEEDLES = {
  head: "</head>",
  paper: '<div class="paper">',
  footerMeta: '<p class="footer-meta">',
  footer: "</footer>",
  bodyEnd: "</body>",
} as const;

const FAVICON =
  "<link rel=\"icon\" type=\"image/svg+xml\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23c45a3b'/%3E%3Cline x1='8' y1='10' x2='24' y2='10' stroke='white' stroke-width='2.5' stroke-linecap='round'/%3E%3Cline x1='8' y1='16' x2='20' y2='16' stroke='white' stroke-width='2.5' stroke-linecap='round' opacity='.7'/%3E%3Cline x1='8' y1='22' x2='16' y2='22' stroke='white' stroke-width='2.5' stroke-linecap='round' opacity='.4'/%3E%3C/svg%3E\">";
const SKIP_LINK = '<a href="#main" class="skip-link">Skip to content</a>';

const navHtml = (date: string, toggle: boolean): string =>
  topbar(
    [
      ["/", "&larr; Archive"],
      ["/sources", "Sources"],
      ["/threads", "Threads"],
      ["/stats", "Stats"],
    ],
    `${translatePill(`/issues/${date}/translate`)}${toggle ? TOGGLE_BTN : ""}`,
  );

export const LEGACY_NAV_CSS = `.site-chrome{--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;--serif:"Source Serif 4",Georgia,"Times New Roman",serif;--muted:color-mix(in srgb,currentColor 65%,transparent);--hair:color-mix(in srgb,currentColor 25%,transparent);--accent:#b1352a;--accent-ink:currentColor;--bg:transparent;margin:0 0 24px;}
.site-chrome .topbar{margin-bottom:0;}`;
const legacyNav = (date: string, main: boolean): string =>
  `<div class="site-chrome">${navHtml(date, false)}</div>${main ? '<div id="main" tabindex="-1"></div>' : ""}`;

const BODY_OPEN = /<body\b[^>]*>/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

function documentStart(html: string): number {
  const head = html.indexOf(NEEDLES.head);
  if (head >= 0) return head + NEEDLES.head.length;
  return DOCTYPE.exec(html)?.[0].length ?? 0;
}

const feedbackHtml = (date: string, email: string | undefined): string =>
  email
    ? `<p class="footer-feedback">Got feedback or a suggestion? <a href="mailto:${escapeHtml(email)}?subject=Digest%20feedback%20-%20${date}">Send a note &rarr;</a></p>`
    : "";

const ARTICLE = /<article\b([^>]*)\bid="([^"]+)"[^>]*>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>/g;
export function storyRail(html: string): string {
  const stories = [...html.matchAll(ARTICLE)].map((m) => ({
    tier: /class="[^"]*\bbrief\b/.test(m[1]!) ? "sk" : "mk",
    id: m[2]!,
    headline: m[3]!
      .replace(/<a class="anchor"[\s\S]*?<\/a>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
  }));
  if (stories.length < 2) return "";
  const items = stories.map(
    (s, i) =>
      `${i > 0 && s.tier !== stories[i - 1]!.tier ? '<li class="gap" aria-hidden="true"></li>' : ""}<li class="${s.tier}"><a href="#${s.id}"><span class="rail-tip">${s.headline}</span></a></li>`,
  );
  return `<nav class="rail" aria-label="Stories in this issue"><ol>${items.join("")}</ol></nav>`;
}

function inject(html: string, needle: string, replacement: string, missed: string[]): string {
  const i = html.indexOf(needle);
  if (i < 0) {
    missed.push(needle);
    return html;
  }
  return html.slice(0, i) + replacement + html.slice(i + needle.length);
}

export function renderIssue(
  ctx: PageCtx,
  date: string,
  stored: { html: string; preheader: string },
  mdAbs: string,
): { html: string; missed: string[] } {
  const missed: string[] = [];
  const { cfg } = ctx;
  const title = escapeHtml(`${cfg.digestName} – ${date}`);
  const description = escapeHtml(stored.preheader);
  const canonical = cfg.digestDomain ? `https://${cfg.digestDomain}/issues/${date}` : "";
  const og = `<meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="${escapeHtml(cfg.digestName)}">
  <meta name="description" content="${description}">
  ${ogImageTags(ogImageUrl(cfg))}`;
  const headInject = `<meta name="color-scheme" content="light dark">
  ${FAVICON}
  ${og}
  ${markdownLinkTag(`/issues/${date}.md`)}
  <script>${proxyTranslateHideScript}</script>
  <script>${NO_FLASH_JS}</script>`;
  const legacy = !stored.html.includes(NEEDLES.paper);
  const rail = legacy ? "" : storyRail(stored.html);
  const navCss = legacy ? `${digestNavCss}\n${LEGACY_NAV_CSS}` : rail ? `${digestNavCss}\n${railCss}` : digestNavCss;
  let html = inject(
    stored.html,
    NEEDLES.head,
    `${headInject}\n<style>${navCss}</style>\n<style>${fontFace(ctx.assets.fontUrl)}\n${skipLinkCss}\n${reducedMotionCss}</style></head>`,
    missed,
  );
  const bodyOpen = BODY_OPEN.exec(html);
  const at = bodyOpen ? bodyOpen.index + bodyOpen[0].length : documentStart(html);
  const nav = legacy ? legacyNav(date, !/\bid=["']?main\b/.test(html)) : "";
  html = `${html.slice(0, at)}${SKIP_LINK}${hiddenPointer(mdAbs)}${nav}${html.slice(at)}`;
  if (!legacy) html = inject(html, NEEDLES.paper, `${NEEDLES.paper}${navHtml(date, true)}`, missed);
  const feedback = feedbackHtml(date, cfg.contactEmail);
  if (feedback) {
    html = html.includes(NEEDLES.footerMeta)
      ? inject(html, NEEDLES.footerMeta, `${feedback}\n    ${NEEDLES.footerMeta}`, missed)
      : inject(html, NEEDLES.footer, `${feedback}\n  </footer>`, missed);
  }
  const tail = `${rail ? `${rail}<script>${railJs}</script>` : ""}<script>${toggleJs}</script>`;
  html = html.includes(NEEDLES.bodyEnd) ? html.replace(NEEDLES.bodyEnd, () => `${tail}</body>`) : `${html}${tail}`;
  return { html, missed };
}

export function issuePage(
  ctx: PageCtx,
  date: string,
  stored: { html: string; preheader: string },
  mdAbs: string,
): string {
  const { html, missed } = renderIssue(ctx, date, stored, mdAbs);
  for (const needle of missed)
    log.error({
      site: "issue",
      date,
      needle,
      error: "web injection missed; the stored HTML drifted from the template",
    });
  return html;
}

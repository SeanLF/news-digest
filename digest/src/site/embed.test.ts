import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadAssets, renderWeb, type Selections, type Story } from "../render/render.js";
import type { IssueRowData } from "./data.js";
import { leaningOf, readIssue } from "./embed.js";
import { loadCatalogue } from "./sources.js";
import { SOURCES_FILE, fakeData, testApp, testConfig } from "./testing.js";

// The embed reads the lead out of the HTML web.ts writes, so it is held against the renderer itself:
// a change to the issue's markup that the embed no longer reads fails here, not on seanfloyd.dev.

const REPO = new URL("../../../", import.meta.url).pathname;
const renderAssets = loadAssets({ templates: `${REPO}digest/templates`, design: `${REPO}design` });
const renderEnv = { digestName: "Sean's Daily Digest", digestDomain: "digest.example", archiveUrl: "https://digest.example", authorName: "", authorUrl: "" };
const render = (selections: Selections) => renderWeb({ selections, now: new Date("2026-10-25T10:42:00Z"), issueNo: 312, env: renderEnv, assets: renderAssets });

const src = (name: string, bias: string, n: number) => ({ name, bias, url: `https://${name.toLowerCase().replaceAll(/\W/g, "")}.example/2026/10/25/story-${n}`, original_title: `${name} headline ${n}` });
const LEAD: Story = {
  headline: "Houthis encircle Taiz as UAE agrees to rejoin the fight",
  summary: "A summary.",
  why_it_matters: "Riyadh now needs the UAE's money & its allies' <patience>.",
  reporting_varies: [
    { source: "Al Jazeera", angle: "Sets the CENTCOM claim against the UKMTO count." },
    { source: "Financial Times", angle: "Frames it as a reprieve." },
    { source: "Reuters", angle: "Leads with the siege." },
    { source: "Der Spiegel", angle: "A fourth angle the card leaves out." },
  ],
  sources: [src("Al Jazeera", "lean-left", 1), src("The Guardian", "lean-left", 2), src("Financial Times", "center", 3), src("Fox News", "right", 4)],
  thread: { thread_id: 1039, day: 6, url: "https://digest.example/thread/1039" },
};
const ISSUE: Selections = { preheader: "p", must_know: [LEAD, { headline: "Second", summary: "s", sources: [src("BBC", "center", 5)] }], should_know: [{ headline: "Brief", summary: "b", sources: [src("BBC", "center", 6)] }] };

describe("reading the lead from a rendered issue", () => {
  const issue = readIssue(render(ISSUE));

  it("finds the lead's headline, thread, why-it-matters and angles as the issue prints them", () => {
    expect(issue.lead).toMatchObject({
      headline: "Houthis encircle Taiz as UAE agrees to rejoin the fight",
      thread: { id: 1039, day: 6 },
      why: "Riyadh now needs the UAE&#39;s money &amp; its allies&#39; &lt;patience&gt;.",
    });
    expect(issue.lead!.varies.map((v) => v.outlet)).toEqual(["Al Jazeera", "Financial Times", "Reuters", "Der Spiegel"]);
    expect(issue.lead!.slug).toMatch(/^houthis-encircle-taiz/);
  });

  it("reads the bias bar's segments and both of its labels", () => {
    expect(issue.lead!.segments).toEqual([
      { leaning: "l", n: 2 },
      { leaning: "c", n: 1 },
      { leaning: "r", n: 1 },
    ]);
    expect(issue.lead!.counts).toBe("4 reports · 4 outlets");
    expect(issue.lead!.split).toBe("2 left · 1 center · 1 right");
  });

  it("keeps the issue's brand and stylesheet", () => {
    expect(issue.brand).toContain("Digest");
    expect(issue.styles.join("")).toContain(".biasbar");
  });

  it("has no lead when the issue has no must-know story", () => {
    expect(readIssue(render({ ...ISSUE, must_know: [] })).lead).toBeUndefined();
  });

  it("has no thread chip before a thread's second day", () => {
    expect(readIssue(render({ ...ISSUE, must_know: [{ ...LEAD, thread: { day: 1 } }] })).lead!.thread).toBeUndefined();
  });
});

describe("an outlet's leaning", () => {
  const leaning = leaningOf(loadCatalogue(SOURCES_FILE));
  it("is the catalogue's by name, the agency's for wire copy, and unrated otherwise", () => {
    expect(leaning("Al Jazeera")).toBe("l");
    expect(leaning("Reuters")).toBe("c");
    expect(leaning("PA Media")).toBe("u");
    expect(leaning("Left outlets (Guardian, MSNBC)")).toBe("u");
  });
});

const row = (date: string, over: Partial<IssueRowData> = {}): IssueRowData => ({ date, preheader: "", issueNo: 312, must: 3, should: 11, isMonthStart: false, sourceIds: [], ...over });
const appWith = (issues: Record<string, string>, env: Record<string, string> = {}) =>
  testApp(
    fakeData({
      archive: async () => Object.keys(issues).toSorted().toReversed().map((d, i) => row(d, { issueNo: 312 - i })),
      issue: async (d) => (issues[d] === undefined ? undefined : { html: issues[d], preheader: "", markdown: null }),
    }),
    { cfg: testConfig({ EMBED_ANCESTORS: "https://seanfloyd.dev https://seanfloyd.dev.local", ...env }) },
  );
const directive = (csp: string, name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("GET /embed/lead", () => {
  const app = appWith({ "2026-10-25": render(ISSUE) });

  it("may be framed by the configured origins only, with no X-Frame-Options", async () => {
    const res = await app.request("/embed/lead");
    expect(res.status).toBe(200);
    expect(directive(res.headers.get("content-security-policy")!, "frame-ancestors")).toBe("frame-ancestors https://seanfloyd.dev https://seanfloyd.dev.local");
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    // A framer that sends COEP require-corp loads only a frame that sends both.
    expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });

  it.each(["/", "/issues/2026-10-25", "/today", "/no/such/page"])("leaves %s framable by the site alone", async (path) => {
    const res = await app.request(path);
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(directive(res.headers.get("content-security-policy")!, "frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(res.headers.get("cross-origin-embedder-policy")).toBeNull();
    expect(res.headers.get("cross-origin-resource-policy")).toBeNull();
  });

  it("allows each of its inline stylesheets by hash, and runs no script", async () => {
    const res = await app.request("/embed/lead");
    const html = await res.text();
    const csp = res.headers.get("content-security-policy")!;
    expect(html).not.toMatch(/<script/i);
    expect(directive(csp, "script-src")).toBe("script-src 'none'");
    for (const [, body] of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) expect(csp).toContain(`'sha256-${createHash("sha256").update(body!, "utf8").digest("base64")}'`);
  });

  it("shows the masthead, the lead, at most three angles and the spread, linking out of the frame", async () => {
    const html = await (await app.request("/embed/lead")).text();
    expect(html).toContain("Issue 312 · 14 stories");
    expect(html).toMatch(/<h3 class="head"><a href="https:\/\/digest\.example\/issues\/2026-10-25#houthis-encircle-taiz[^"]*" target="_top">Houthis encircle Taiz/);
    expect(html).toContain('<a href="https://digest.example/thread/1039" target="_top"><span class="loc">Ongoing</span> · day 6 ↗</a>');
    expect(html).toContain("Why it matters");
    expect(html).toContain('<span class="dot l" aria-hidden="true"></span><b>Al Jazeera<span class="vh"> (left)</span>:</b>');
    expect(html).toContain("Reuters<span");
    expect(html).not.toContain("A fourth angle");
    expect(html).toContain("4 reports · 4 outlets · 2 left · 1 center · 1 right");
    expect(html).toContain('<link rel="canonical" href="https://digest.example/issues/2026-10-25">');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("/assets/fonts/source-serif-4.");
  });

  it("falls back to the newest issue that has a lead", async () => {
    const html = await (await appWith({ "2026-10-26": render({ ...ISSUE, must_know: [] }), "2026-10-25": render(ISSUE) }).request("/embed/lead")).text();
    expect(html).toContain("/issues/2026-10-25#");
    expect(html).toContain("Issue 311");
  });

  it("is a framable card, not an error page, when no issue has a lead", async () => {
    const res = await appWith({}).request("/embed/lead");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(await res.text()).toContain("No issue yet");
  });

  const fa = async (env: Record<string, string>) => directive((await appWith({ "2026-10-25": render(ISSUE) }, env).request("/embed/lead")).headers.get("content-security-policy")!, "frame-ancestors");
  it("takes HOMEPAGE_URL's origin when EMBED_ANCESTORS is unset, and only the site when neither is", async () => {
    expect(await fa({ EMBED_ANCESTORS: "", HOMEPAGE_URL: "https://seanfloyd.dev/about" })).toBe("frame-ancestors https://seanfloyd.dev");
    expect(await fa({ EMBED_ANCESTORS: "" })).toBe("frame-ancestors 'self'");
  });
});

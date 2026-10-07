import { readFileSync } from "node:fs";
import { htmlEscape } from "escape-goat";
import { describe, expect, it } from "vitest";
import { roundHalfEven, slugify } from "./common.js";
import { applyDecodedLinks, attachThreads, loadAssets, renderEmail, renderWeb, resolveArticleIds, type RenderInput, type Selections } from "./render.js";

const REPO = new URL("../../../", import.meta.url).pathname;
const assets = loadAssets({ templates: `${REPO}digest/templates`, design: `${REPO}design` });
const edge = () => JSON.parse(readFileSync(new URL("./fixtures/edge_selections.json", import.meta.url), "utf8")) as Selections;
const env = { digestName: "Digest", digestDomain: "news.example", archiveUrl: "https://news.example", authorName: "Sean", authorUrl: "https://author.example/" };
const input = (selections: Selections): RenderInput => ({ selections, now: new Date("2026-09-18T10:42:40Z"), issueNo: 277, env, assets });

describe("the Python's arithmetic and text rules", () => {
  it("rounds halves to even, as Python's round() does", () => {
    expect([0.5, 1.5, 2.5, 12.5, 62.5, 2.4, 2.6].map(roundHalfEven)).toEqual([0, 2, 2, 12, 62, 2, 3]);
  });
  it("slugs to ASCII, cut at 60 without a trailing hyphen, 'story' when nothing is left", () => {
    expect(slugify("Zürich café — 文A")).toBe("z-rich-caf-a");
    expect(slugify("!!!")).toBe("story");
    expect(slugify(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });
});

describe("resolution", () => {
  const index = {
    A1: { name: "Reuters", url: "https://www.reuters.com/a", bias: "center", source_id: "reuters", original_title: "Deal signed - Reuters", wire: true },
    A2: { name: "Straits Times", url: "https://st.example/a", bias: "center", source_id: "st", original_title: "Deal signed" },
    A3: { name: "BBC", url: "https://bbc.example/a", bias: "center", source_id: "bbc", original_title: "Another take" },
    A4: { name: "Broken", url: "https://x.example/a" },
  };
  it("resolves ids, keeps a verbatim repost for the sources box to group, and drops what it cannot resolve", () => {
    const sel: Selections = { must_know: [{ headline: "h", sources: [{ article_id: "A2" }, { article_id: "A1" }, { article_id: "A3" }, { article_id: "A9" }] }], should_know: [{ headline: "gone", sources: [{ article_id: "A4" }] }] };
    const out = resolveArticleIds(sel, index);
    expect(out.must_know[0]!.sources.map((s) => s.name)).toEqual(["Straits Times", "Reuters", "BBC"]);
    expect(out.should_know).toEqual([]);
  });
  it("tags an untagged article as wire copy when its full text opens with a wire dateline", () => {
    const sel: Selections = { must_know: [{ headline: "h", sources: [{ article_id: "A2" }, { article_id: "A3" }] }], should_know: [] };
    const fulltext = { A2: { text: "Deal signed LONDON, Sept 27 (AFP) - The deal" }, A3: { text: "Another take on it." } };
    const out = resolveArticleIds(sel, index, fulltext);
    expect(out.must_know[0]!.sources.map((s) => s.wire_agency ?? null)).toEqual(["afp", null]);
  });
  it("names an angle's outlet from the index, not the writer's text", () => {
    const sel: Selections = { must_know: [{ headline: "h", sources: [{ article_id: "A3" }], reporting_varies: [{ source: "British Broadcasting Corp", angle: "a", bias: "center", article_id: "A3" }] }], should_know: [] };
    expect(resolveArticleIds(sel, index).must_know[0]!.reporting_varies).toEqual([{ source: "BBC", angle: "a", bias: "center" }]);
  });
  it("names an angle from wire copy after the agency, as the sources box does", () => {
    const sel: Selections = { must_know: [{ headline: "h", sources: [{ article_id: "A2" }], reporting_varies: [{ source: "Straits Times", angle: "a", bias: "center", article_id: "A2" }] }], should_know: [] };
    const fulltext = { A2: { text: "Deal signed LONDON, Sept 27 (AFP) - The deal" } };
    expect(resolveArticleIds(sel, index, fulltext).must_know[0]!.reporting_varies?.[0]?.source).toBe("AFP");
  });
  it("upgrades a decoded Google-News link and leaves the rest", () => {
    const sel: Selections = { must_know: [{ sources: [{ name: "Reuters", url: "https://news.google.com/rss/articles/X" }, { name: "BBC", url: "https://bbc.example/a" }] }], should_know: [] };
    expect(applyDecodedLinks(sel, { "https://news.google.com/rss/articles/X": "https://www.reuters.com/x" }).must_know[0]!.sources.map((s) => s.url)).toEqual(["https://www.reuters.com/x", "https://bbc.example/a"]);
  });
  it("attaches thread context by cluster, and to neither of two stories sharing one", () => {
    const sel: Selections = { must_know: [{ cluster_id: "a", sources: [] }, { cluster_id: "b", sources: [] }, { cluster_id: "b", sources: [] }], should_know: [] };
    const out = attachThreads(sel, { a: { day: 3, url: "/thread/1" }, b: { day: 4 } });
    expect(out.must_know.map((s) => s.thread?.day)).toEqual([3, undefined, undefined]);
  });
});

describe("the web issue", () => {
  it("fills placeholders literally: editorial text carrying $& and $1 survives", () => {
    const html = renderWeb(input(edge()));
    expect(html).toContain("Because $1 &amp; $&amp; and $&#39; matter");
    expect(html).toContain('<a href="https://author.example/privacy">Privacy</a>');
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
  it("refuses to ship an unfilled placeholder", () => {
    expect(() => renderWeb({ ...input(edge()), assets: { ...assets, template: `${assets.template}{{UNKNOWN_SLOT}}` } })).toThrow(/Unfilled placeholder in rendered digest: \{\{UNKNOWN_SLOT\}\}/);
  });
});

// The seam the spec names (§6): two renderers, one data source. Every story the web issue shows,
// the email shows, in the same order, with the same headline, body and source count.
const text = (s: string) => s.replaceAll(/<[^>]+>/g, " ").replaceAll("&nbsp;", " ").replaceAll(/\s+/g, " ");
const sourceCounts = (t: string) => [...t.matchAll(/(\d+) reports? · (\d+) outlets?/gi)].map((m) => `${m[1]}/${m[2]}`);
describe("email and web show the same issue", () => {
  it.each([["edge", edge()], ["kitchen sink", JSON.parse(readFileSync(`${REPO}digest/src/render/fixtures/kitchensink_selections.json`, "utf8")) as Selections]] as const)("%s", (_n, sel) => {
    const web = text(renderWeb(input(sel)));
    const email = text(renderEmail(input(sel)));
    let wAt = 0;
    let eAt = 0;
    for (const s of [...sel.must_know, ...sel.should_know]) {
      const body = (s.thread?.delta ?? "").trim() || (s.summary ?? "");
      for (const field of [s.headline ?? "", body].filter((f) => !/\{\{[A-Z_]+\}\}/.test(f))) {
        const want = text(htmlEscape(field));
        const w = web.indexOf(want, wAt);
        const e = email.indexOf(want, eAt);
        expect(w, `web lacks ${field}`).toBeGreaterThanOrEqual(0);
        expect(e, `email lacks ${field}`).toBeGreaterThanOrEqual(0);
        wAt = w + 1;
        eAt = e + 1;
      }
    }
    expect(sourceCounts(web).length).toBeGreaterThan(0);
    expect(sourceCounts(email)).toEqual(sourceCounts(web));
  });
  // Inherited from the Python, kept for parity and reported: the web fills placeholders across the
  // whole page, editorial text included, so a story quoting {{DATE}} reads differently in each.
  it("diverges where editorial text quotes a placeholder", () => {
    const sel = edge();
    expect(text(renderWeb(input(sel)))).toContain("it quotes Friday, September 18, 2026 literally");
    expect(text(renderEmail(input(sel)))).toContain("it quotes {{DATE}} literally");
  });
});

describe("the web stylesheet", () => {
  // lightningcss with no targets upgrades syntax: `(min-width:760px)` became `(width>=760px)`, which
  // Safari before 16.4 reads as false, dropping both layouts. The Python ships the old syntax.
  const css = /<style>([\s\S]*?)<\/style>/.exec(renderWeb(input(edge())))?.[1] ?? "";
  it("keeps media queries in the syntax older Safari reads", () => {
    expect(css).toMatch(/\(min-width:\s*760px\)/);
    expect(css).not.toMatch(/\(width\s*[<>]=?/);
  });
  it("keeps the underline thickness as its own property", () => {
    expect(css).toMatch(/text-decoration-thickness:/);
  });
});

// 0-1px sizes are MJML's spacer cells, not text.
const textSizesUnder12 = (html: string) =>
  [...html.matchAll(/font-size\s*[:=]\s*"?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((n) => n > 1 && n < 12);

describe("small text", () => {
  it("sets nothing below 12px on the web issue", () => {
    expect(textSizesUnder12(renderWeb(input(edge())))).toEqual([]);
  });
  it("sets nothing below 12px in the email", () => {
    expect(textSizesUnder12(renderEmail(input(edge())))).toEqual([]);
  });
  // At 12px the email's dateline wraps on a phone; it may break only at a slash.
  it("keeps each part of the email dateline on one line", () => {
    const email = renderEmail(input(edge()));
    for (const part of ["Friday, September 18, 2026", "min read", "must-know"]) {
      expect(email).toMatch(new RegExp(`<span style="white-space:nowrap;">[^<]*${part}`));
    }
  });
});

const story = (sources: Selections["must_know"][number]["sources"]): Selections => ({
  must_know: [{ headline: "Arrests near air base", summary: "Five men held.", why_it_matters: "A 999 call.", reporting_varies: [{ source: "FT", angle: "an Iran link", bias: "center" }], sources }],
  should_know: [],
});
describe("the sources box", () => {
  const fairford = story([
    { name: "Reuters", url: "https://reuters.example/a", bias: "center", original_title: "Five men held - Reuters", wire: true, wire_agency: "reuters" },
    { name: "Straits Times", url: "https://st.example/a", bias: "lean-right", original_title: "Police question five men", wire_agency: "reuters" },
    { name: "Guardian", url: "https://guardian.example/a", bias: "lean-left", original_title: "Minister hints services knew" },
  ]);
  const shared = story([
    { name: "A", url: "https://a.example/a", bias: "center", original_title: "Same words" },
    { name: "B", url: "https://b.example/a", bias: "lean-left", original_title: "Same words" },
  ]);

  it("counts reports and outlets on the web, with the reprint under its origin", () => {
    const web = renderWeb(input(fairford));
    expect(text(web)).toContain("2 reports · 3 outlets");
    expect(web).toMatch(/<tr class="carrier"><td class="nm">↳ Straits Times<\/td>/);
    expect(web).toContain('<span class="via"> · wire</span>');
    expect(web).toContain('class="seg l"');
    expect(web).toContain('class="seg c"');
    expect(web).not.toContain('class="seg r"');
  });

  it("shows identical untagged headlines as shared copy, unrated", () => {
    const web = renderWeb(input(shared));
    expect(text(web)).toContain("1 report · 2 outlets");
    expect(text(web)).toContain("Shared copy");
    expect(web).toContain('class="seg u"');
  });

  it("gives the email one line of counts and a link, and none of the box", () => {
    const email = renderEmail(input(fairford));
    expect(text(email)).toContain("2 reports · 3 outlets");
    expect(email).toMatch(/<a href="https:\/\/news\.example\/issues\/2026-09-18#arrests-near-air-base"[^>]*>Sources and coverage →<\/a>/);
    expect(text(email)).not.toContain("How reporting varies");
    expect(email).not.toMatch(/<td height="4"/);
  });

  it("keeps how reporting varies on the web", () => {
    expect(text(renderWeb(input(fairford)))).toContain("How reporting varies");
  });
});

const withClaims = (): Selections => {
  const sel = story([
    { article_id: "A1", name: "Reuters", url: "https://reuters.example/a", bias: "center", original_title: "Five men held - Reuters", wire: true, wire_agency: "reuters" },
    { article_id: "A2", name: "Straits Times", url: "https://st.example/a", bias: "lean-right", original_title: "Police question five men", wire_agency: "reuters" },
    { article_id: "A3", name: "Guardian", url: "https://guardian.example/a", bias: "lean-left", original_title: "Minister hints services knew" },
  ]);
  sel.must_know[0]!.claims = [
    { field: "summary", text: "five men questioned", supported_by: ["A2"] },
    { field: "summary", text: "Streeting's partial picture", supported_by: ["A3"] },
    { field: "headline", text: "arrests near the base", supported_by: ["A1", "A3"] },
  ];
  return sel;
};
describe("what each report backs", () => {
  it("adds the column when the story has claims, each report listing what its articles back", () => {
    const web = renderWeb(input(withClaims()));
    expect(web).toContain('<th scope="col">What it backs</th>');
    expect(web).toMatch(/Reuters<span class="via"> · wire<\/span><\/td><td class="ln">center<\/td><td class="bk">five men questioned; arrests near the base<\/td>/);
    expect(web).toMatch(/Guardian<\/td><td class="ln">lean-left<\/td><td class="bk">Streeting&#39;s partial picture; arrests near the base<\/td>/);
  });
  it("keeps today's table when the story has no claims", () => {
    const sel = withClaims();
    delete sel.must_know[0]!.claims;
    expect(renderWeb(input(sel))).not.toContain("What it backs");
  });
});

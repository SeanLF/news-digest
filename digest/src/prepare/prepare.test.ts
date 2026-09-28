import { wireAgency, wireFromDateline, wireFromFullText } from "./wire.js";
import { describe, expect, it } from "vitest";
import { TfidfMatcher, tokenize } from "./dedup.js";
import { prepareArticles, toCsv, ARTICLE_HEADER } from "./prepare.js";
import { canonicalUrl, escapeHtml, stripHtml, truncate } from "./text.js";

describe("prepare text helpers", () => {
  it("strips tags, decodes entities, collapses whitespace; escapes as Python's html.escape", () => {
    expect(stripHtml("<p>Tom &amp; Jerry&nbsp;&#39;s <b>show</b></p>\n ")).toBe("Tom & Jerry 's show");
    expect(escapeHtml(`a & "b" <c> 'd'`)).toBe("a &amp; &quot;b&quot; &lt;c&gt; &#x27;d&#x27;");
    expect(truncate("😀😀😀", 2)).toBe("😀😀");
  });
  it("canonicalises scheme, host, trailing slash and fragment, never path or query", () => {
    expect(canonicalUrl("HTTPS://Example.COM/News/a/?x=1#top")).toBe("https://example.com/News/a?x=1");
    expect(canonicalUrl("https://example.com/")).toBe("https://example.com");
  });
});

describe("dedup matcher", () => {
  it("drops punctuation and stopwords in every covered language", () => {
    expect(tokenize("The vote, in Berlin: der Kanzler!")).toEqual(["vote", "berlin", "kanzler"]);
  });
  it("finds a near-duplicate title and scores an unrelated one low", () => {
    const m = new TfidfMatcher(["Sweden centre-left wins election", "Japan raises rates", "Nigeria floods kill dozens"]);
    expect(m.findMostSimilar("Sweden centre-left wins election, SVT says").headline).toBe("Sweden centre-left wins election");
    expect(m.findMostSimilar("Mars rover finds ice").score).toBe(0);
  });
});

const src = (id: string) => ({ id, name: id, bias: "center", factuality: "high", perspective: "global" });
const f = (title: string, url: string) => ({ title, url, published: "2026-09-18", summary: "<b>s</b>" });

describe("prepareArticles", () => {
  it("scrubs links out of titles and summaries by default", () => {
    const out = prepareArticles([src("hn")], new Map([["hn", [{ title: "Jemalloc 5.4", url: "https://hn.test/1", published: "", summary: "Article URL: https://github.com/jemalloc" }]]]), []);
    expect(out.files[0]!.rows[0]![4]).toBe("Article URL: [link]");
  });
  it("scrubs before the cap, so a link straddling the 200-character cap leaves no partial URL", () => {
    const summary = `${"x".repeat(190)} https://github.com/jemalloc/jemalloc/releases`;
    const out = prepareArticles([src("hn")], new Map([["hn", [{ title: "T", url: "https://hn.test/1", published: "", summary }]]]), []);
    const kept = out.files[0]!.rows[0]![4]!;
    expect(kept.length).toBeLessThanOrEqual(200);
    expect(kept).not.toMatch(/http|github/);
  });
  it("numbers survivors in source order, drops unsafe and repeated URLs and recent titles", () => {
    const out = prepareArticles([src("a"), src("b")], new Map([["b", [f("B one", "https://b.test/1")]], ["a", [f("A one", "https://a.test/1"), f("A dup", "https://A.test/1/"), f("A ftp", "ftp://a.test/2"), f("Japan raises rates", "https://a.test/3")]]]), ["Japan raises rates"]);
    expect(out.files[0]!.rows.map((r) => [r[0], r[2]])).toEqual([["A1", "A one"], ["A2", "B one"]]);
    expect(out.urlDuplicates).toBe(1);
    expect(out.filtered.map((x) => x.title)).toEqual(["Japan raises rates"]);
    expect(toCsv(ARTICLE_HEADER, out.files[0]!.rows)).toBe("article_id,source_id,title,published,summary\nA1,a,A one,2026-09-18,s\nA2,b,B one,2026-09-18,s\n");
  });
});

describe("wire detection", () => {
  it("matches an agency exactly, never as a substring", () => {
    expect(wireAgency("  The Associated Press. ")).toBe("associated press");
    expect(wireAgency("Reuters Institute")).toBeNull();
    expect(wireAgency("Michael Bloomberg")).toBeNull();
  });
  it("reads a dateline at the start of a body", () => {
    expect(wireFromDateline("WASHINGTON (Reuters) - The Senate voted")).toBe("reuters");
    expect(wireFromDateline("By Jane Doe RIO DE JANEIRO, July 24 (AP) — Police")).toBe("ap");
    expect(wireFromDateline("Officials told AP the talks stalled")).toBeNull();
  });
  it("reads a dateline after the headline an extracted article opens with", () => {
    expect(wireFromFullText("US Senate rejects resolution curbing Trump's Iran war powers WASHINGTON, Sept 24 (Reuters) - The US Senate on")).toBe("reuters");
    expect(wireFromFullText("Iran's army voices readiness for potential renewed US attack DUBAI, Sept 27 (Reuters) - Iran's armed forces")).toBe("reuters");
    expect(wireFromFullText("Talks stall By Samia Nakhoul and Parisa Hafezi DUBAI/LONDON, Sept 24 (Reuters) - Talks")).toBe("reuters");
    expect(wireFromFullText("Men arrested at UK air base By Toby Shepheard FAIRFORD, England, Sept 27 (Reuters) - Police")).toBe("reuters");
    expect(wireFromFullText("Netanyahu visited Abu Dhabi on Sunday, Israeli official says Sept 27 (Reuters) - Israeli Prime")).toBe("reuters");
    expect(wireFromFullText("Strike kills 12 BEIRUT, Sept 24 (Reuters) - 12 people were killed")).toBe("reuters");
    expect(wireFromFullText("Macron speaks PARIS, Sept 24 (AFP) - Élysée Palace said")).toBe("afp");
  });
  it("takes no credit that is not a dateline", () => {
    expect(wireFromFullText("Oil jumps. Prices rose, the minister told Reuters (Reuters) on Monday")).toBeNull();
    expect(wireFromFullText("A spokesperson said (AP) sources were wrong - later")).toBeNull();
    expect(wireFromFullText(`${"x ".repeat(400)}PARIS (AFP) - late in the text`)).toBeNull();
    expect(wireFromFullText("Officials met with NATO (AP) - leaders said the alliance")).toBeNull();
    expect(wireFromFullText("The ECB (AP) - policymakers voted")).toBeNull();
    expect(wireFromFullText("PARIS SAINT-GERMAIN (AFP) - the club said")).toBeNull();
    expect(wireFromFullText("Storm hits coast MANILA (AP) — A storm")).toBeNull();
    expect(wireFromFullText("the vote on Sept 24 (AP) - which side wins is unclear")).toBeNull();
    expect(wireFromFullText("Officials said on Sept 24 (Reuters) - talks continue mid-article")).toBeNull();
  });
});

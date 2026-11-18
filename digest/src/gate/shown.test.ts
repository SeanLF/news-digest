import { describe, expect, it } from "vitest";
import { shownStories } from "./shown.js";

const story = (headline: string, ids: string[]) => ({
  headline,
  summary: "the drafted summary",
  why_it_matters: "",
  sources: ids.map((article_id) => ({ article_id })),
});

const PAGE = `<section><article class="first"><h3 class="head">Oleshky truce ends<a class="anchor" href="#x" aria-label="Copy link"></a></h3>
<p class="eyebrow"><a href="t">Ongoing · day 2</a></p>
<p class="lede">Ukraine evacuated nearly 200 civilians &amp; more.</p>
<div class="why"><span class="lbl">Why it matters</span><p>It sets a precedent.</p></div>
<div class="varies"><p><b>FT:</b> angle</p></div></article>
<article class="brief"><h3>A brief</h3><p class="summary">Brief text.</p></article></section>`;

describe("shownStories", () => {
  it("reads the text the reader sees, the thread's rewrite of a summary included, with each story's cited ids from selections", () => {
    const stories = shownStories(PAGE, {
      must_know: [story("Oleshky truce ends", ["A1", "A2"])],
      should_know: [story("A brief", ["A3"])],
    });
    expect(stories).toEqual([
      {
        index: 0,
        fields: {
          headline: "Oleshky truce ends",
          summary: "Ukraine evacuated nearly 200 civilians & more.",
          why_it_matters: "It sets a precedent.",
        },
        sources: ["A1", "A2"],
      },
      { index: 1, fields: { headline: "A brief", summary: "Brief text." }, sources: ["A3"] },
    ]);
  });
});

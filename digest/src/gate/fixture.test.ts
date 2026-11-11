import { describe, expect, it } from "vitest";
import { fixtureFromRun, plantedCopy } from "./fixture.js";
import type { Plant } from "./plant.js";

const story = (h: string, s: string, w: string, id: string) => ({
  headline: h,
  summary: s,
  why_it_matters: w,
  sources: [{ article_id: id }],
});
const two = {
  must_know: [
    story("Talks resume after 12 days", "Officials said 3,000 attended.", "The 2 sides differ.", "A1"),
    story("Vote passes 58 to 40", "Turnout was 58% in O'Hare.", "A 9 point swing.", "A2"),
  ],
  should_know: [story("Rain", "It rained.", "", "A3")],
  preheader: "p",
};
const page = (s: typeof two) =>
  `<p>${s.preheader}</p>` +
  s.must_know
    .map(
      (x) => `<h3>${x.headline}</h3><p class="lede">${x.summary.replace("'", "&#39;")}</p><p>${x.why_it_matters}</p>`,
    )
    .join("");
const clean = {
  "digest.html": page(two),
  "inputs/selections.json": JSON.stringify(two, null, 2),
  "inputs/draft_selections.json": JSON.stringify(two, null, 2),
};

describe("plantedCopy", () => {
  it("plants the defects into the digest the judges read and the selections they check it against", () => {
    const out = plantedCopy(clean, 1, 3);
    const { plants } = JSON.parse(out["planted/plants.json"]!) as { plants: Plant[] };
    expect(plants).toHaveLength(3);
    const sel = JSON.parse(out["planted/inputs/selections.json"]!) as typeof two;
    const draft = JSON.parse(out["planted/inputs/draft_selections.json"]!) as typeof two;
    for (const p of plants) {
      expect(out["planted/digest.html"]).not.toContain(p.original.replace("'", "&#39;"));
      expect(out["planted/digest.html"]).toContain(p.planted.replace("'", "&#39;"));
      expect(sel.must_know[p.storyIndex]![p.field]).toBe(p.planted);
      expect(draft.must_know[p.storyIndex]![p.field]).toBe(p.planted);
    }
    expect(clean["digest.html"]).toBe(page(two));
  });
  it("only plants a field the digest shows, with a marker no story already carries", () => {
    const hidden = { ...clean, "digest.html": page(two).replace("The 2 sides differ.", "") };
    for (let seed = 0; seed < 20; seed++) {
      const { plants } = JSON.parse(plantedCopy(hidden, seed, 2)["planted/plants.json"]!) as { plants: Plant[] };
      for (const p of plants) {
        expect(`${p.storyIndex}:${p.field}`).not.toBe("0:why_it_matters");
        expect(JSON.stringify(two).replaceAll(",", "")).not.toMatch(new RegExp(`(?<!\\d)${p.marker}(?!\\d)`));
      }
    }
  });
  it("is reproducible from the seed it records", () => {
    const a = plantedCopy(clean, 5, 2);
    expect(plantedCopy(clean, 5, 2)).toEqual(a);
    expect((JSON.parse(a["planted/plants.json"]!) as { seed: number }).seed).toBeGreaterThanOrEqual(5);
  });
  it("gives up rather than plant into text the digest does not show", () => {
    expect(() => plantedCopy({ ...clean, "digest.html": "<p>nothing</p>" }, 1, 1)).toThrow(/no seed/);
  });
});

const selections = {
  must_know: [
    {
      headline: "Talks resume after 12 days",
      summary: "Officials said 3,000 attended.",
      why_it_matters: "The 2 sides differ.",
      sources: [{ article_id: "A1" }],
    },
  ],
  should_know: [],
  preheader: "p",
};
const run = {
  "digest.html": '<h3>Talks resume after 12 days</h3><a href="https://x.test/a">Reuters</a>',
  "selections.json": JSON.stringify(selections),
  "draft_selections.json": JSON.stringify(selections),
  "article_fulltext.json": JSON.stringify({ A1: { text: "Read more at https://x.test/a." } }),
  "articles_1.csv": "article_id,source_id,title,published,summary\nA1,bbc,T,2026-11-06,See https://x.test/a now\n",
  "articles_2.csv": "article_id,source_id,title,published,summary\n",
  "email.html": "<p>not a judge input</p>",
  "run.json": JSON.stringify({ rows: [{ id: 349, started_at: "2026-11-06T10:25:00Z", git_sha: "5a1d9a9" }] }),
};

describe("fixtureFromRun", () => {
  it("lays a run out as a gate fixture: the digest as shipped, the judge's inputs under inputs/", () => {
    const f = fixtureFromRun(run);
    expect(Object.keys(f).toSorted()).toEqual([
      "digest.html",
      "inputs/article_fulltext.json",
      "inputs/articles_1.csv",
      "inputs/articles_2.csv",
      "inputs/draft_selections.json",
      "inputs/selections.json",
      "source.json",
    ]);
    expect(f["digest.html"]).toBe(run["digest.html"]);
  });
  it("replaces every URL in the inputs with [link] and keeps the JSON valid", () => {
    const f = fixtureFromRun(run);
    for (const [name, text] of Object.entries(f))
      if (name.startsWith("inputs/")) expect(text, name).not.toMatch(/https?:|\/\/x\.test/);
    expect(f["inputs/articles_1.csv"]).toContain("See [link] now");
    expect((JSON.parse(f["inputs/article_fulltext.json"]!) as { A1: { text: string } }).A1.text).toBe(
      "Read more at [link].",
    );
  });
  it("records where the fixture came from, with a digest of each artifact it was cut from", () => {
    const src = JSON.parse(fixtureFromRun(run)["source.json"]!) as { artifacts: Record<string, string> };
    expect(src).toMatchObject({ run: 349, date: "2026-11-06", git_sha: "5a1d9a9" });
    expect(Object.keys(src.artifacts).toSorted()).toEqual([
      "article_fulltext.json",
      "articles_1.csv",
      "articles_2.csv",
      "digest.html",
      "draft_selections.json",
      "selections.json",
    ]);
    expect(src.artifacts["digest.html"]).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it("refuses a run missing a judge input rather than writing half a fixture", () => {
    const { "selections.json": _s, ...noSelections } = run;
    expect(() => fixtureFromRun(noSelections)).toThrow(/selections\.json/);
    const noCsv = Object.fromEntries(Object.entries(run).filter(([k]) => !k.endsWith(".csv")));
    expect(() => fixtureFromRun(noCsv)).toThrow(/articles_\*\.csv/);
  });
  it("refuses selections that are not the shipped contract", () => {
    expect(() => fixtureFromRun({ ...run, "selections.json": JSON.stringify({ must_know: "x" }) })).toThrow();
  });
});

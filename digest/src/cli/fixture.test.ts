import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportFixture } from "./fixture.js";

const selections = {
  must_know: [{ headline: "H 12", summary: "S 3", why_it_matters: "W 2", sources: [{ article_id: "A1" }] }],
  should_know: [],
  preheader: "p",
};

describe("fixture export", () => {
  it("reads a directory of a run's artifacts and writes the fixture under the out directory", () => {
    const raw = mkdtempSync(join(tmpdir(), "raw-"));
    const out = join(mkdtempSync(join(tmpdir(), "fx-")), "day-349");
    const files: Record<string, string> = {
      "digest.html": "<h3>H 12</h3>",
      "selections.json": JSON.stringify(selections),
      "draft_selections.json": JSON.stringify(selections),
      "article_fulltext.json": "{}",
      "articles_1.csv": "article_id,source_id,title,published,summary\n",
    };
    for (const [n, t] of Object.entries(files)) writeFileSync(join(raw, n), t);
    mkdirSync(join(raw, "ignored-dir"));
    exportFixture(raw, out);
    expect(readdirSync(out).toSorted()).toEqual(["digest.html", "inputs", "source.json"]);
    expect(readdirSync(join(out, "inputs")).toSorted()).toEqual([
      "article_fulltext.json",
      "articles_1.csv",
      "draft_selections.json",
      "selections.json",
    ]);
    expect(readFileSync(join(out, "digest.html"), "utf8")).toBe("<h3>H 12</h3>");
  });
});

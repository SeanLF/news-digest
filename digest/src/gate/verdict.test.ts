import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PREHEADER_MAX_CHARS } from "../contracts/selections.js";
import { CRITERIA, parseVerdicts } from "./verdict.js";

const rubric = readFileSync(new URL("../../gate/rubric.md", import.meta.url), "utf8");

describe("parseVerdicts", () => {
  it("parses the outermost JSON array out of a chatty reply and validates each cell", () => {
    expect(parseVerdicts('thinking...\n[{"story":0,"criterion":1,"pass":true,"reason":"ok"}]\ndone')).toEqual([
      { story: 0, criterion: 1, pass: true, reason: "ok" },
    ]);
    expect(() => parseVerdicts("no json here")).toThrow(/array/);
    expect(() => parseVerdicts('[{"story":0,"criterion":9,"pass":true}]')).toThrow(/malformed/);
    expect(parseVerdicts('[{"story":3,"criterion":8,"pass":false,"reason":"same as 1"}]')[0]?.criterion).toBe(8);
  });
});

describe("the rubric the judges get", () => {
  it("numbers exactly the criteria the parser accepts", () => {
    const numbered = [...rubric.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(numbered).toEqual(Array.from({ length: CRITERIA }, (_, i) => i + 1));
  });
  it("caps the preheader where the contract does", () => {
    expect(rubric).toContain(`at most ${PREHEADER_MAX_CHARS} characters`);
  });
  it("says what [link] is, so no judge fails a story for a scrubbed URL", () => {
    expect(rubric).toMatch(/`\[link\]` marks where a URL was removed/);
  });
  it("scores briefs too, numbered after the must_know stories", () => {
    expect(rubric).toMatch(/must_know stories first,\s+then the briefs/);
  });
  it("judges selection per story, so a missing story fails no selected one", () => {
    expect(rubric).toMatch(/a story\s+the digest leaves out fails no story here/);
  });
  it("has a criterion for the same event told twice", () => {
    expect(rubric).toMatch(/\*\*Distinct\.\*\* The story does not report the same event as an earlier story/);
  });
});

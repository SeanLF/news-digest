import { describe, expect, it } from "vitest";
import { judgeReport, repsByJudge } from "./judge-report.js";
import type { Plant } from "./plant.js";

const cell = (story: number, criterion: number, pass: boolean, reason = "r") => ({ story, criterion, pass, reason });
const out = (cells: ReturnType<typeof cell>[]) => ({ response: { output: `here:\n${JSON.stringify(cells)}` } });
const promptfoo = (rows: { label: string; cells: ReturnType<typeof cell>[] | "junk" }[]) => ({
  results: {
    results: rows.map((r) => ({
      provider: { id: "x", label: r.label },
      ...(r.cells === "junk" ? { response: { output: "I could not finish" } } : out(r.cells)),
    })),
  },
});
const plant: Plant = {
  storyIndex: 0,
  field: "summary",
  kind: "wrong-number",
  original: "58%",
  planted: "117%",
  marker: "117",
};
const caughtBy = [cell(0, 1, false, "117% is not in A1"), cell(1, 1, true)];
const missedBy = [cell(0, 1, true), cell(1, 1, true)];

describe("repsByJudge", () => {
  it("groups the reps by judge, an unreadable rep kept as null so it still counts", () => {
    const reps = repsByJudge(
      promptfoo([
        { label: "a", cells: [cell(0, 1, true)] },
        { label: "a", cells: "junk" },
      ]),
    );
    expect(reps.get("a")).toEqual([[cell(0, 1, true)], null]);
  });
  it("refuses a file that is not promptfoo output", () => {
    expect(() => repsByJudge({})).toThrow(/promptfoo/);
  });
});

describe("judgeReport", () => {
  const clean = promptfoo([
    { label: "opus", cells: [cell(0, 1, true), cell(1, 1, false)] },
    { label: "opus", cells: [cell(0, 1, true), cell(1, 1, true)] },
    { label: "codex", cells: [cell(0, 1, false, "no"), cell(1, 1, false)] },
    { label: "codex", cells: [cell(0, 1, false, "no"), cell(1, 1, false)] },
  ]);
  it("passes only when every judge catches the planted copy's defects", () => {
    const planted = promptfoo([
      { label: "opus", cells: caughtBy },
      { label: "codex", cells: caughtBy },
    ]);
    expect(judgeReport(clean, planted, [plant], 1).verdict).toBe("pass");
    const oneMisses = promptfoo([
      { label: "opus", cells: caughtBy },
      { label: "codex", cells: missedBy },
    ]);
    const r = judgeReport(clean, oneMisses, [plant], 1);
    expect(r.verdict).toBe("fail");
    expect(r.control.codex).toMatchObject({ caught: 0, total: 1, pass: false });
  });
  it("fails a judge with no planted reps at all", () => {
    const r = judgeReport(clean, promptfoo([{ label: "opus", cells: caughtBy }]), [plant], 1);
    expect(r.control.codex?.pass).toBe(false);
    expect(r.verdict).toBe("fail");
  });
  it("reports each judge's band, pass rate, and the cells where the families' majorities differ", () => {
    const r = judgeReport(clean, clean, [plant], 1);
    expect(r.judges.opus).toMatchObject({
      reps: 2,
      unreadable: 0,
      overall: 0.5,
      passRate: { overall: 0.75, mustKnow: 1, briefs: 0.5 },
    });
    expect(r.judges.codex).toMatchObject({ overall: 1, passRate: { overall: 0 } });
    expect(r.disagreements).toEqual([
      { story: 0, criterion: 1, votes: { opus: "2/2 pass", codex: "0/2 pass" }, reasons: { opus: "r", codex: "no" } },
    ]);
  });
});

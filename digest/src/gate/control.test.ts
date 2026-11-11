import { describe, expect, it } from "vitest";
import { catches, CONTROL_MIN_RECALL, controlResult } from "./control.js";
import type { Plant } from "./plant.js";
import type { JudgeVerdict } from "./verdict.js";

const plant: Plant = {
  storyIndex: 1,
  field: "summary",
  kind: "wrong-number",
  original: "Turnout was 58%.",
  planted: "Turnout was 117%.",
  marker: "117",
};
const geneva: Plant = { ...plant, storyIndex: 0, kind: "absent-specific", marker: "Geneva" };
const v = (story: number, criterion: JudgeVerdict["criterion"], pass: boolean, reason: string): JudgeVerdict => ({
  story,
  criterion,
  pass,
  reason,
});

describe("the judges' negative control", () => {
  it("counts a catch only as a fail on support or binding, on the planted story, naming the planted specific", () => {
    expect(catches(plant, [v(1, 1, false, "Sources give 58%, not 117%.")])).toBe(true);
    expect(catches(plant, [v(1, 2, false, "117% turnout is bound to the wrong vote")])).toBe(true);
    expect(catches(plant, [v(1, 1, true, "117% is in A2")])).toBe(false);
    expect(catches(plant, [v(0, 1, false, "117% is unsupported")])).toBe(false);
    expect(catches(plant, [v(1, 4, false, "117% is filler")])).toBe(false);
    expect(catches(plant, [v(1, 1, false, "The turnout figure is unsupported")])).toBe(false);
  });
  it("matches the planted number as a whole number, with or without thousands separators", () => {
    const big = { ...plant, marker: "6001" };
    expect(catches(big, [v(1, 1, false, "6,001 is not in the sources")])).toBe(true);
    expect(catches(big, [v(1, 1, false, "16001 is not in the sources")])).toBe(false);
    expect(catches(geneva, [v(0, 1, false, "No source says the measure was announced in geneva")])).toBe(true);
  });
  it("does not take an article id or a longer decimal for the planted number", () => {
    const seven = { ...plant, marker: "7" };
    expect(catches(seven, [v(1, 1, false, "A7 does not say who won")])).toBe(false);
    expect(catches(seven, [v(1, 1, false, "0.7 is not in the sources")])).toBe(false);
    expect(catches(seven, [v(1, 1, false, "the Nov. 7 date is not in A3")])).toBe(true);
    expect(catches(seven, [v(1, 1, false, "7.4% is not in the sources")])).toBe(true);
    expect(catches({ ...plant, marker: "21" }, [v(1, 1, false, '"€21bn": the source gives €10 billion')])).toBe(true);
  });
  it("scores every plant in every rep, and an unreadable rep catches nothing", () => {
    const hit = [v(1, 1, false, "117% unsupported"), v(0, 1, false, "Geneva is absent")];
    expect(controlResult([plant, geneva], [hit, hit, null])).toEqual({
      caught: 4,
      total: 6,
      recall: 4 / 6,
      pass: false,
    });
    expect(controlResult([plant, geneva], [hit, hit]).pass).toBe(true);
    expect(controlResult([plant], []).pass).toBe(false);
  });
  it("holds the bar at 0.8, fixed before the first run", () => {
    expect(CONTROL_MIN_RECALL).toBe(0.8);
  });
});

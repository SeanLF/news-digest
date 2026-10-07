import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MODEL_FANOUT_LIMIT } from "../workflow/bounded.js";
import { agentsWith } from "./agent-overrides.js";
import { callBudget, Slots, WEIGHT } from "./replay-provider.js";

describe("replay provider", () => {
  it("a stage that fans out its model calls holds that many slots", () => {
    expect(WEIGHT).toEqual({ cluster: MODEL_FANOUT_LIMIT, attribute: MODEL_FANOUT_LIMIT, select: 1, coherence: 1 });
  });

  it("refuses a call budget that is not a positive whole number, instead of turning the bound off", () => {
    expect(callBudget(undefined)).toBe(4);
    expect(callBudget("8")).toBe(8);
    for (const bad of ["x", "0", "-1", "2.5", ""]) expect(() => callBudget(bad)).toThrow(/REPLAY_CALLS/);
  });

  it("serves waiters in order, so a wide call is not starved by narrow ones behind it", async () => {
    const s = new Slots(4), order: string[] = [];
    await s.take(3);
    const wide = s.take(4).then(() => order.push("wide"));
    const narrow = s.take(1).then(() => order.push("narrow"));
    await Promise.resolve();
    expect(order).toEqual([]); // narrow fits in the free slot but waits behind wide
    s.give(3);
    await wide;
    s.give(4);
    await narrow;
    expect(order).toEqual(["wide", "narrow"]);
  });

  it("an override naming an unknown stage leaves no copied directory behind", () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("agents-")).length;
    expect(() => agentsWith(new URL("../../agents/", import.meta.url).pathname, { selekt: { effort: "high" } })).toThrow(/selekt/);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("agents-")).length).toBe(before);
  });
});

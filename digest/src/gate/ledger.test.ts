import { describe, expect, it } from "vitest";
import { ledgerLine } from "./ledger.js";

const results = (costs: number[], failures = 0, timestamp = "2026-11-11T01:57:51.297Z") => ({
  results: {
    timestamp,
    stats: { successes: costs.length - failures, failures, errors: 0 },
    results: costs.map((cost) => ({ cost, provider: { id: "p" } })),
  },
});

describe("ledgerLine", () => {
  it("is one JSON line: date, sha, eval, config, verdict, API-equivalent cost and reps", () => {
    const line = ledgerLine([results([1.86, 1.92, 2.6])], { eval: "band", config: "gate/band.yaml", sha: "abc1234" });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim()).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      date: "2026-11-11T01:57:51Z",
      sha: "abc1234",
      eval: "band",
      config: "gate/band.yaml",
      verdict: "pass",
      cost_usd: 6.38,
      calls: 3,
    });
  });
  it("takes promptfoo's verdict unless the eval gave its own, and sums every results file", () => {
    const failed = JSON.parse(ledgerLine([results([1], 1)], { eval: "e", config: "c", sha: "s" })) as {
      verdict: string;
    };
    expect(failed.verdict).toBe("fail");
    const judged = JSON.parse(
      ledgerLine([results([0.5, 0]), results([0.25])], {
        eval: "judges",
        config: "c",
        sha: "s",
        verdict: "fail",
        note: "control",
      }),
    ) as Record<string, unknown>;
    expect(judged).toMatchObject({ verdict: "fail", cost_usd: 0.75, calls: 3, note: "control" });
  });
  it("refuses what is not promptfoo output rather than record a zero-cost run", () => {
    expect(() => ledgerLine([{}], { eval: "e", config: "c", sha: "s" })).toThrow(/promptfoo/);
  });
});

import { describe, expect, it } from "vitest";
import { recallOnPlants } from "./score.js";
describe("score", () => {
  it("recall counts a plant caught when its story's field is flagged", () => {
    const plants = [
      {
        storyIndex: 1,
        field: "summary" as const,
        kind: "wrong-number" as const,
        original: "58%",
        planted: "117%",
        marker: "117",
      },
    ];
    const report = {
      results: [
        { headline: "Talks", article_ids: ["A1"], pass: true, reason: "ok" },
        {
          headline: "Vote",
          article_ids: ["A2"],
          pass: false,
          reason: "summary: x",
          failed_fields: ["summary" as const],
        },
      ],
    };
    expect(recallOnPlants(plants, report)).toEqual({ caught: 1, total: 1 });
    expect(recallOnPlants([{ ...plants[0]!, field: "headline" }], report)).toEqual({ caught: 0, total: 1 });
    expect(recallOnPlants([{ ...plants[0]!, storyIndex: 9 }], report)).toEqual({ caught: 0, total: 1 });
  });
});

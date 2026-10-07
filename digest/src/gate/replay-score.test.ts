import { describe, expect, it } from "vitest";
import { breaches, scoreAttribute, scoreCluster, scoreCoherence, scoreSelect } from "./replay-score.js";

const claim = (s: string[], d: string[]) => ({ field: "summary", text: "t", supported_by: s, differs: d.map((article_id) => ({ article_id })) });

describe("replay scores against the run's own artifact", () => {
  it("cluster: pairs kept from the reference, and pairs it lacks (lumping)", () => {
    const ref = { clusters: [{ article_ids: ["A1", "A2", "A3"] }, { article_ids: ["A4"] }] };
    const out = { clusters: [{ article_ids: ["A1", "A2"] }, { article_ids: ["A3", "A4"] }] };
    expect(scoreCluster(out, ref)).toEqual({ keeps: 1 / 3, adds: 1 / 3, clusters: 2, refClusters: 2 });
    expect(scoreCluster(ref, ref).keeps).toBe(1);
  });

  it("select: must-know and pick agreement by cluster index", () => {
    const ref = { must_know: [{ cluster_index: 0 }, { cluster_index: 1 }], should_know: [{ cluster_index: 2 }] };
    const out = { must_know: [{ cluster_index: 0 }], should_know: [{ cluster_index: 1 }, { cluster_index: 3 }] };
    expect(scoreSelect(out, ref)).toEqual({ mustAgree: 0.5, pickedAgree: 0.5, must: 1, picked: 3 });
  });

  it("coherence: a miss is a story the reference failed and the replay passed", () => {
    const ref = { results: [{ article_ids: ["A2", "A1"], pass: false, headline: "doctored quote" }, { article_ids: ["A3"], pass: true, headline: "fine" }, { article_ids: ["A9"], pass: true, headline: "gone" }] };
    const out = { results: [{ article_ids: ["A1", "A2"], pass: true, headline: "doctored quote" }, { article_ids: ["A3"], pass: false, headline: "fine" }] };
    expect(scoreCoherence(out, ref)).toEqual({ stories: 2, disagree: 1, misses: 1, extras: 1, unmatched: 1, missed: ["doctored quote"], extra: ["fine"] });
  });

  it("attribute: a claim is identical only when both its supporting and differing sets match", () => {
    const ref = { stories: { k: { claims: [claim(["A1", "A2"], [])] }, j: { claims: [claim(["A3"], ["A4"])] } } };
    const out = { stories: { k: { claims: [claim(["A2", "A1"], [])] }, j: { claims: [claim(["A3"], [])] } } };
    expect(scoreAttribute(out, ref)).toEqual({ claims: 2, identical: 0.5, differs: 0, refDiffers: 1 });
  });

  it("a rule reports each breach, and a score it names that does not exist", () => {
    expect(breaches({ misses: 1, disagree: 0.05 }, { misses: { max: 0 }, disagree: { max: 0.1 } })).toEqual(["misses 1 > 0"]);
    expect(breaches({ keeps: 0.8 }, { keeps: { min: 0.85 }, kept: { min: 1 } })).toEqual(["keeps 0.8 < 0.85", "kept: no such score"]);
    expect(breaches({ misses: 0 }, { misses: { max: 0 } })).toEqual([]);
  });
});

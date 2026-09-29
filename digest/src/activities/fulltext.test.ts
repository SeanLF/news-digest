import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../store/artifacts.js";
import { freshDb } from "../store/test-db.js";
import { candidateIds, FULLTEXT_HEALTH, FULLTEXT_OUTPUT, FULLTEXT_TOPUP_HEALTH, fulltextActivities } from "./fulltext.js";

const selected = {
  must_know: [{ cluster_index: 1, article_ids: ["A1", "A2", "A3", "A4"] }],
  should_know: [{ cluster_index: 2, article_ids: ["A2", "A5"] }, "junk"],
};
const index = { A1: { url: "https://a.com/1" }, A2: { url: "https://b.com/2" }, A3: {}, A5: { url: "https://c.com/5" } };

async function setup(enabled = true) {
  const store = new ArtifactStore(await freshDb([300]));
  const sel = await store.put(300, "selected.json", JSON.stringify(selected));
  await store.put(300, "article_index.json", JSON.stringify(index));
  return { store, sel, acts: fulltextActivities({ store, perStory: 3, enabled }) };
}

describe("fulltext", () => {
  it("takes the first perStory ids of every story, deduped, in SELECT's order (fulltext._candidate_article_ids)", async () => {
    expect(candidateIds(selected, 3)).toEqual(["A1", "A2", "A3", "A5"]);
  });
  it("plans a task for every candidate with a URL", async () => {
    const { sel, acts } = await setup();
    expect(await acts.planFulltext(300, sel)).toEqual({ tasks: [["A1", "https://a.com/1"], ["A2", "https://b.com/2"], ["A5", "https://c.com/5"]] });
  });
  it("plans nothing when the output already exists, unless forced", async () => {
    const { store, sel, acts } = await setup();
    const done = await store.put(300, FULLTEXT_OUTPUT, "{}");
    expect(await acts.planFulltext(300, sel)).toEqual({ tasks: [], existing: done });
    expect((await acts.planFulltext(300, sel, true)).tasks).toHaveLength(3);
  });
  it("a stored attempt that did not complete is quarantined and planned again, so a resume retries it", async () => {
    const { store, sel, acts } = await setup();
    await acts.storeFulltext(300, { tasks: 3, results: {}, outcome: "unavailable" });
    const plan = await acts.planFulltext(300, sel);
    expect(plan.tasks).toHaveLength(3);
    expect(plan.existing).toBeUndefined();
    expect(await store.find(300, FULLTEXT_OUTPUT)).toBeUndefined();
    expect(await store.statuses(300, FULLTEXT_OUTPUT)).toContain("quarantined");
    await acts.storeFulltext(300, { tasks: 3, results: { A1: "Body text that came back this time." }, outcome: "completed" });
    expect((await acts.planFulltext(300, sel)).existing).toBeDefined();
  });
  it("an attempt the fetcher's deadline cut short is planned again on a resume", async () => {
    const { store, sel, acts } = await setup();
    await acts.storeFulltext(300, { tasks: 3, results: { A1: "Body text that came back in time." }, outcome: "deadline" });
    const plan = await acts.planFulltext(300, sel);
    expect(plan.tasks).toHaveLength(3);
    expect(plan.existing).toBeUndefined();
    expect(await store.statuses(300, FULLTEXT_OUTPUT)).toContain("quarantined");
  });
  it("an archived output with no health record is kept: nothing says it failed", async () => {
    const { store, sel, acts } = await setup();
    await store.put(300, FULLTEXT_OUTPUT, JSON.stringify({ A1: { text: "archived" } }));
    expect((await acts.planFulltext(300, sel)).existing).toBeDefined();
  });
  it("switched off (FULLTEXT_ENABLED=false), it plans nothing and says why", async () => {
    const { sel, acts } = await setup(false);
    expect(await acts.planFulltext(300, sel)).toEqual({ tasks: [], skip: "disabled" });
  });
  it("with no candidates it plans nothing and says why", async () => {
    const { store, acts } = await setup();
    const empty = await store.put(300, "selected_empty.json", JSON.stringify({ must_know: [], should_know: [] }));
    expect(await acts.planFulltext(300, empty)).toEqual({ tasks: [], skip: "no_candidates" });
  });
  it("stores the texts with links scrubbed, in the archive's shape, and records health", async () => {
    const { store, acts } = await setup();
    const p = await acts.storeFulltext(300, { tasks: 3, results: { A1: "Body text, see https://x.com/y for more." }, outcome: "completed" });
    expect(JSON.parse(await store.get(p))).toEqual({ A1: { text: "Body text, see [link] for more." } });
    expect(JSON.parse(await store.content(300, FULLTEXT_HEALTH))).toEqual({ tasks: 3, extracted: 1, outcome: "completed" });
  });
  it("an unavailable fetcher stores an empty map, so the run goes on without full text", async () => {
    const { store, acts } = await setup();
    const p = await acts.storeFulltext(300, { tasks: 3, results: {}, outcome: "unavailable" });
    expect(await store.get(p)).toBe("{}");
    expect(JSON.parse(await store.content(300, FULLTEXT_HEALTH))).toMatchObject({ extracted: 0, outcome: "unavailable" });
  });
});

async function drafted(enabled = true) {
  const { store, acts } = await setup(enabled);
  await store.put(300, FULLTEXT_OUTPUT, JSON.stringify({ A1: { text: "already here" } }));
  const drafts = [
    await store.put(300, "draft_s00.json", JSON.stringify({ plan: { index: 0 }, story: { headline: "h", sources: [{ article_id: "A1" }, { article_id: "A5" }] } })),
    await store.put(300, "draft_s01.json", JSON.stringify({ plan: { index: 1 }, story: { headline: "g", sources: [{ article_id: "A2" }, { article_id: "A3" }, { article_id: "A5" }] } })),
  ];
  return { store, acts, drafts };
}

describe("fulltext top-up, for what WRITE cited", () => {
  it("plans the cited articles that have no text yet and a URL to fetch, each once", async () => {
    const { acts, drafts } = await drafted();
    expect(await acts.planFulltextTopup(300, drafts)).toEqual({ tasks: [["A5", "https://c.com/5"], ["A2", "https://b.com/2"]] });
  });
  it("merges what comes back into the run's full text and records how the top-up went", async () => {
    const { store, acts, drafts } = await drafted();
    const plan = await acts.planFulltextTopup(300, drafts);
    await acts.storeFulltextTopup(300, { tasks: plan.tasks.length, results: { A5: "Fresh body, see https://x.example/y" }, outcome: "completed" });
    const text = JSON.parse(await store.get((await store.find(300, FULLTEXT_OUTPUT))!)) as Record<string, { text: string }>;
    expect(Object.keys(text).toSorted()).toEqual(["A1", "A5"]);
    expect(text["A5"]!.text).not.toContain("https://");
    expect(JSON.parse(await store.get((await store.find(300, FULLTEXT_TOPUP_HEALTH))!))).toEqual({ tasks: 2, extracted: 1, outcome: "completed" });
  });
  it("a settled top-up is not repeated on a resume; an unsettled one is planned again", async () => {
    const { store, acts, drafts } = await drafted();
    await acts.storeFulltextTopup(300, { tasks: 2, results: {}, outcome: "unavailable" });
    expect((await acts.planFulltextTopup(300, drafts)).tasks).toHaveLength(2);
    expect(await store.statuses(300, FULLTEXT_TOPUP_HEALTH)).toContain("quarantined");
    await acts.storeFulltextTopup(300, { tasks: 2, results: { A2: "Body two." }, outcome: "completed" });
    expect(await acts.planFulltextTopup(300, drafts)).toEqual({ tasks: [], existing: await store.find(300, FULLTEXT_OUTPUT) });
  });
  it("switched off, it plans nothing and says why", async () => {
    const { acts, drafts } = await drafted(false);
    expect(await acts.planFulltextTopup(300, drafts)).toEqual({ tasks: [], skip: "disabled" });
  });
  it("with every cited article already read, it has nothing to fetch", async () => {
    const { store, acts } = await setup();
    await store.put(300, FULLTEXT_OUTPUT, JSON.stringify({ A1: { text: "x" } }));
    const d = [await store.put(300, "draft_s00.json", JSON.stringify({ plan: { index: 0 }, story: { headline: "h", sources: [{ article_id: "A1" }] } }))];
    expect(await acts.planFulltextTopup(300, d)).toEqual({ tasks: [], skip: "no_candidates" });
  });
  it("a resume that redoes the first fetch redoes the top-up too, since the first quarantines what the top-up merged", async () => {
    const { store, acts, drafts } = await drafted();
    await store.quarantine(300, FULLTEXT_OUTPUT);
    await acts.storeFulltext(300, { tasks: 3, results: {}, outcome: "unavailable" });
    await acts.storeFulltextTopup(300, { tasks: 2, results: { A5: "Top-up body." }, outcome: "completed" });
    const sel = (await store.find(300, "selected.json"))!;
    await acts.planFulltext(300, sel);
    expect(await store.statuses(300, FULLTEXT_TOPUP_HEALTH)).toContain("quarantined");
    await acts.storeFulltext(300, { tasks: 3, results: { A1: "First pass body." }, outcome: "completed" });
    expect((await acts.planFulltextTopup(300, drafts)).tasks.map(([id]) => id)).toContain("A5");
  });
});

describe("a source whose pages we do not fetch", () => {
  it("gets no fetch on either pass, and its slot in a story goes to the next article", async () => {
    const store = new ArtifactStore(await freshDb([300]));
    await store.put(300, "article_index.json", JSON.stringify({ A1: { url: "https://www.lemonde.fr/1", source_id: "le_monde" }, A2: { url: "https://b.com/2", source_id: "bbc" }, A3: { url: "https://c.com/3", source_id: "dw" }, A4: { url: "https://d.com/4", source_id: "npr" }, A5: { url: "https://www.lemonde.fr/5", source_id: "le_monde" } }));
    const sel = await store.put(300, "selected.json", JSON.stringify({ must_know: [{ article_ids: ["A1", "A2", "A3", "A4"] }], should_know: [] }));
    const acts = fulltextActivities({ store, perStory: 3, enabled: true, notFetched: new Set(["le_monde"]) });
    expect(await acts.planFulltext(300, sel)).toEqual({ tasks: [["A2", "https://b.com/2"], ["A3", "https://c.com/3"], ["A4", "https://d.com/4"]] });
    await acts.storeFulltext(300, { tasks: 3, results: {}, outcome: "completed" });
    const draft = await store.put(300, "draft_s00.json", JSON.stringify({ plan: { index: 0 }, story: { headline: "h", sources: [{ article_id: "A5" }, { article_id: "A2" }] } }));
    expect((await acts.planFulltextTopup(300, [draft])).tasks).toEqual([["A2", "https://b.com/2"]]);
  });
});

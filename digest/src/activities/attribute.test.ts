import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { SdkQuery } from "../runner/run-stage.js";
import { ArtifactStore, type Pointer } from "../store/artifacts.js";
import { freshDb } from "../store/test-db.js";
import { attributeActivity, quoteFound, type AttributionDoc } from "./attribute.js";

const AGENTS = new URL("../../agents/", import.meta.url).pathname;
type Verdict = { claim: string; verdict: "states" | "differs" | "silent"; quote?: string };

function replying(...replies: Record<string, Verdict[]>[]) {
  const prompts: string[] = [];
  const options: Options[] = [];
  const q = (({ prompt, options: o }: { prompt: string; options?: Options }) => {
    prompts.push(prompt);
    if (o) options.push(o);
    const reply = replies[Math.min(prompts.length - 1, replies.length - 1)] ?? {};
    const structured = { articles: Object.entries(reply).map(([article_id, verdicts]) => ({ article_id, verdicts })) };
    return (function* () {
      yield { type: "result", subtype: "success", result: JSON.stringify(structured), structured_output: structured, total_cost_usd: 0.02, usage: {}, duration_ms: 5, is_error: false, num_turns: 1, session_id: "s" } as unknown as SDKMessage;
    })();
  }) as unknown as SdkQuery;
  return { q, prompts, options };
}

async function setup(claims: unknown[], resolution: unknown[] = []) {
  const store = new ArtifactStore(await freshDb([300]));
  await store.put(300, "articles_1.csv", "article_id,source_id,title,published,summary\nA1,bbc,Pope in Paris,2026-09-26T19:48:00+00:00,An estimated 700&#x27;000 gathered\nA2,f24,Mass in Paris,2026-09-26T20:28:00+00:00,Pope Leo XIV celebrates Mass in front of 800000 people\nA3,aj,Olive tree,2026-09-26T10:00:00+00:00,Mamdani plants a tree\n");
  await store.put(300, "article_fulltext.json", JSON.stringify({ A2: { text: "Pope Leo XIV celebrated Mass on the Place de la Concorde before 800,000 people, the Vatican said." } }));
  const story = { headline: "Pope draws 800,000", summary: "S", why_it_matters: "W", sources: [{ article_id: "A1" }, { article_id: "A2" }, { article_id: "A3" }] };
  const drafts: Pointer[] = [await store.put(300, "draft_s00.json", JSON.stringify({ plan: { index: 0, tier: "must_know", storyIds: ["A1"], contextIds: ["A1"] }, story }))];
  const report = await store.put(300, "coherence_report.json", JSON.stringify({ results: [{ headline: story.headline, article_ids: ["A1", "A2", "A3"], pass: true, reason: "ok", claims }] }));
  const repair = await store.put(300, "repair_resolution.json", JSON.stringify({ input: "x", results: resolution }));
  return { store, drafts, report, repair };
}
const CLAIMS = [
  { field: "summary", text: "800,000 at the Mass", supported_by: ["A2"] },
  { field: "summary", text: "Place de la Concorde", supported_by: [] },
];
const doc = async (store: ArtifactStore, p: Pointer) => JSON.parse(await store.get(p)) as AttributionDoc;

describe("quoteFound", () => {
  it("finds a quote through entities, curly quotes, dashes, spacing and case", () => {
    expect(quoteFound("an estimated 700'000", "An estimated 700&#x27;000\n gathered")).toBe(true);
    expect(quoteFound("“moral cowards” — he said", 'He called them "moral cowards" - he said.')).toBe(true);
    expect(quoteFound("800,000 people", "before 700,000 people")).toBe(false);
    expect(quoteFound("  ", "anything")).toBe(false);
  });
});

describe("attribute activity", () => {
  it("asks every article about every claim and keeps only answers whose quote is in the article", async () => {
    const { store, drafts, report, repair } = await setup(CLAIMS);
    const { q, prompts, options } = replying({
      A1: [{ claim: "C1", verdict: "differs", quote: "An estimated 700'000 gathered" }, { claim: "C2", verdict: "silent" }],
      A2: [{ claim: "C1", verdict: "states", quote: "before 800,000 people" }, { claim: "C2: Place de la Concorde", verdict: "states", quote: "on the Place de la Concorde" }],
      A3: [{ claim: "C1", verdict: "states", quote: "a quote the article does not hold" }, { claim: "C2", verdict: "silent" }],
    });
    const p = await attributeActivity({ store, agentsDir: AGENTS, query: q })(300, drafts, report, repair);
    const [entry] = Object.values((await doc(store, p)).stories);
    expect(entry?.complete).toBe(true);
    expect(entry?.unverified).toEqual(["A3"]);
    expect(entry?.claims).toEqual([
      { field: "summary", text: "800,000 at the Mass", supported_by: ["A2"], differs: [{ article_id: "A1", quote: "An estimated 700'000 gathered", published: "2026-09-26T19:48:00+00:00" }] },
      { field: "summary", text: "Place de la Concorde", supported_by: ["A2"], differs: [] },
    ]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("C2: Place de la Concorde");
    expect(prompts[0]).toContain("### A2\nMass in Paris\nPope Leo XIV celebrates Mass in front of 800000 people\n\nPope Leo XIV celebrated Mass");
    expect(prompts[0]).toContain("### A3\nOlive tree\nMamdani plants a tree");
    expect(options[0]?.tools).toEqual([]);
  });
  it("shows an article's own feed title and summary beside its full text, so a bot wall stored as the text still carries what the article is about", async () => {
    const { store, drafts, report, repair } = await setup(CLAIMS);
    await store.replace(300, "article_fulltext.json", JSON.stringify({ A2: { text: "JavaScript is disabled in your browser. Please enable JavaScript to proceed." } }));
    const { q, prompts } = replying({});
    await attributeActivity({ store, agentsDir: AGENTS, query: q })(300, drafts, report, repair);
    expect(prompts[0]).toContain("### A2\nMass in Paris\nPope Leo XIV celebrates Mass in front of 800000 people\n\nJavaScript is disabled");
  });
  it("asks again for a pair left unanswered, and marks the story incomplete if it stays unanswered", async () => {
    const { store, drafts, report, repair } = await setup(CLAIMS);
    const partial = { A1: [{ claim: "C1", verdict: "silent" as const }], A2: [{ claim: "C1", verdict: "silent" as const }, { claim: "C2", verdict: "silent" as const }] };
    const { q, prompts } = replying(partial, partial);
    const p = await attributeActivity({ store, agentsDir: AGENTS, query: q })(300, drafts, report, repair);
    expect(prompts).toHaveLength(2);
    expect(Object.values((await doc(store, p)).stories)[0]?.complete).toBe(false);
  });
  it("attributes a repaired story's recheck claims too, and reuses its result for the same input", async () => {
    const fixed = [{ field: "summary", text: "the fixed specific", supported_by: ["A1"] }];
    const { store, drafts, report, repair } = await setup(CLAIMS, [{ article_ids: ["A1", "A2", "A3"], status: "repaired", recheck_pass: true, patched_fields: { summary: "F" }, claims: fixed }]);
    const { q, prompts } = replying({});
    const run = attributeActivity({ store, agentsDir: AGENTS, query: q });
    const p = await run(300, drafts, report, repair);
    expect(prompts[0]).toContain("C3: the fixed specific");
    expect(await run(300, drafts, report, repair)).toEqual(p);
    expect(prompts).toHaveLength(2);
  });
  it("asks nothing for a story with no claims", async () => {
    const { store, drafts, report, repair } = await setup([]);
    const { q, prompts } = replying({});
    const p = await attributeActivity({ store, agentsDir: AGENTS, query: q })(300, drafts, report, repair);
    expect(prompts).toHaveLength(0);
    expect((await doc(store, p)).stories).toEqual({});
  });
});

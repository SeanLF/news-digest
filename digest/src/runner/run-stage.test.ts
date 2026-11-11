import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { StageSpec } from "./prompt.js";
import type { UsageRow } from "../store/usage.js";
import { runStage, type SdkQuery, type StageResult } from "./run-stage.js";

const spec: StageSpec = {
  name: "coherence",
  model: "claude-sonnet-5",
  thinking: "adaptive",
  tools: ["Read", "Grep"],
  body: "Reply with JSON.",
};

function fakeQuery(messages: SDKMessage[], seen?: { options?: Options }): SdkQuery {
  return (({ options }: { prompt: string; options?: Options }) => {
    if (seen && options) seen.options = options;
    return (function* () {
      yield* messages;
    })();
  }) as unknown as SdkQuery;
}
const result = (over: Record<string, unknown>): SDKMessage =>
  ({
    type: "result",
    subtype: "success",
    result: "{}",
    total_cost_usd: 0,
    usage: {},
    duration_ms: 1,
    is_error: false,
    num_turns: 1,
    session_id: "s",
    ...over,
  }) as unknown as SDKMessage;
const assistant = (content: unknown[]): SDKMessage =>
  ({ type: "assistant", message: { content }, session_id: "s" }) as unknown as SDKMessage;
const call = (q: SdkQuery, schema?: Record<string, unknown>) =>
  runStage(
    spec,
    { userMessage: "Begin.", inputDir: "/in" },
    { today: "2026-09-21", query: q, ...(schema ? { outputSchema: schema } : {}) },
  );

describe("runStage", () => {
  it("collects tool calls in order, the final text, the structured output and the numbers", async () => {
    const q = fakeQuery([
      assistant([
        { type: "tool_use", id: "1", name: "Read", input: { file_path: "/in/a.csv" } },
        { type: "tool_use", id: "2", name: "Grep", input: { pattern: "58%", path: "/in" } },
      ]),
      result({
        result: '{"results":[]}',
        structured_output: { results: [] },
        total_cost_usd: 0.5,
        usage: { output_tokens: 10, server_tool_use: { x: 1 } },
        duration_ms: 1200,
        num_turns: 3,
      }),
    ]);
    const r = await call(q, { type: "object" });
    expect(r.toolCalls).toEqual([
      { name: "Read", target: "/in/a.csv" },
      { name: "Grep", target: "58%" },
    ]);
    expect(r.text).toBe('{"results":[]}');
    expect(r.structured).toEqual({ results: [] });
    expect(r).toMatchObject({ costUsd: 0.5, usage: { output_tokens: 10 }, durationMs: 1200, numTurns: 3 });
  });
  it("reports the effort the request carried: none, so the SDK's default", async () => {
    const seen: { options?: Options } = {};
    const r = await call(fakeQuery([result({})], seen));
    expect(seen.options?.effort).toBeUndefined();
    expect(r.effort).toBe("(sdk default)");
  });
  it("sends and reports the spec's effort level when it names one", async () => {
    const seen: { options?: Options } = {};
    const r = await runStage(
      { ...spec, effort: "high" },
      { userMessage: "Begin.", inputDir: "/in" },
      { today: "2026-09-21", query: fakeQuery([result({})], seen) },
    );
    expect(seen.options?.effort).toBe("high");
    expect(r.effort).toBe("high");
  });
  it("a stage with no tools gets an empty base set: no built-in reaches the model", async () => {
    const seen: { options?: Options } = {};
    await runStage(
      { ...spec, tools: [] },
      { userMessage: "Begin.", inputDir: "/in" },
      { today: "2026-09-21", query: fakeQuery([result({})], seen) },
    );
    expect(seen.options?.tools).toEqual([]);
    expect(seen.options?.disallowedTools).toEqual(expect.arrayContaining(["Read", "Grep", "Bash"]));
  });
  it("passes model, cwd, thinking, the tool base set, allowed and disallowed tools, and the schema through to the SDK options", async () => {
    const seen: { options?: Options } = {};
    await call(fakeQuery([result({ structured_output: {} })], seen), { type: "object" });
    expect(seen.options?.model).toBe("claude-sonnet-5");
    expect(seen.options?.cwd).toBe("/in");
    expect(seen.options?.thinking).toEqual({ type: "adaptive" });
    expect(seen.options?.tools).toEqual(["Read", "Grep"]);
    expect(seen.options?.allowedTools).toEqual(["Read", "Grep"]);
    expect(seen.options?.disallowedTools).toEqual(
      expect.arrayContaining(["Write", "Edit", "Bash", "WebFetch", "WebSearch"]),
    );
    expect(seen.options?.disallowedTools).not.toContain("Read");
    expect(seen.options?.outputFormat).toEqual({ type: "json_schema", schema: { type: "object" } });
    expect(seen.options?.settings).toEqual({ permissions: { blockReadsOutsideWorkingDirectories: true } });
    expect(seen.options?.maxBudgetUsd).toBeUndefined();
  });
  it("hands the SDK an abort controller that follows the activity's cancellation signal", async () => {
    const seen: { options?: Options } = {};
    const ac = new AbortController();
    await runStage(
      spec,
      { userMessage: "Begin.", inputDir: "/in" },
      { today: "2026-09-21", query: fakeQuery([result({})], seen), signal: ac.signal },
    );
    const inner = seen.options?.abortController;
    expect(inner?.signal.aborted).toBe(false);
    ac.abort("cancelled");
    expect(inner?.signal.aborted).toBe(true);
  });
  it("heartbeats on every streamed message", async () => {
    let beats = 0;
    await runStage(
      spec,
      { userMessage: "Begin.", inputDir: "/in" },
      { today: "2026-09-21", query: fakeQuery([assistant([]), assistant([]), result({})]), heartbeat: () => beats++ },
    );
    expect(beats).toBe(3);
  });
  it("omits outputFormat when no schema is requested and falls back to the assistant text", async () => {
    const seen: { options?: Options } = {};
    const r = await call(fakeQuery([assistant([{ type: "text", text: "plain" }]), result({ result: "" })], seen));
    expect(seen.options?.outputFormat).toBeUndefined();
    expect(r.text).toBe("plain");
    expect("structured" in r).toBe(false);
  });
  it("throws when a schema was requested and the success carries no structured output", async () => {
    await expect(call(fakeQuery([result({})]), { type: "object" })).rejects.toThrow(/structured/);
  });
  it("throws on a non-success result and on a stream with no result, never returning partial output", async () => {
    await expect(call(fakeQuery([result({ subtype: "error_max_turns", is_error: true })]))).rejects.toThrow(
      /error_max_turns/,
    );
    await expect(call(fakeQuery([assistant([{ type: "text", text: "partial" }])]))).rejects.toThrow(/no result/);
  });
});

const recorded = (
  q: SdkQuery,
  extra: { schema?: Record<string, unknown>; accept?: (r: StageResult) => void; signal?: AbortSignal } = {},
) => {
  const rows: UsageRow[] = [];
  const run = runStage(
    spec,
    { userMessage: "Begin.", inputDir: "/in" },
    {
      today: "2026-09-21",
      query: q,
      record: { onUsage: (r) => void rows.push(r), stage: "coherence", runId: 300, detail: { story: 2 } },
      ...(extra.schema ? { outputSchema: extra.schema } : {}),
      ...(extra.accept ? { accept: extra.accept } : {}),
      ...(extra.signal ? { signal: extra.signal } : {}),
    },
  );
  return { run, rows };
};
const twoReads = assistant([
  { type: "tool_use", id: "1", name: "Read", input: { file_path: "/in/a.csv" } },
  { type: "tool_use", id: "2", name: "Read", input: { file_path: "/in/b.csv" } },
]);

describe("runStage records every call it makes, with the outcome it had", () => {
  it("a success is ok, with its cost, tokens, turns, tool-call count, spec and branch detail", async () => {
    const { run, rows } = recorded(
      fakeQuery([
        twoReads,
        result({ total_cost_usd: 0.5, usage: { output_tokens: 10 }, duration_ms: 1200, num_turns: 3 }),
      ]),
    );
    await run;
    expect(rows).toEqual([
      {
        stage: "coherence",
        runId: 300,
        story: 2,
        model: "claude-sonnet-5",
        thinking: "adaptive",
        prompt: spec,
        effort: "(sdk default)",
        tokens: { output_tokens: 10 },
        costUsd: 0.5,
        durationMs: 1200,
        numTurns: 3,
        toolCalls: 2,
        outcome: "ok",
      },
    ]);
  });
  it("a non-success result is recorded as an error with what it spent, before the stage throws", async () => {
    const { run, rows } = recorded(
      fakeQuery([
        twoReads,
        result({
          subtype: "error_max_budget_usd",
          is_error: true,
          total_cost_usd: 0.31,
          usage: { output_tokens: 900 },
          duration_ms: 4000,
          num_turns: 7,
        }),
      ]),
    );
    await expect(run).rejects.toThrow(/error_max_budget_usd/);
    expect(rows).toMatchObject([
      { outcome: "error", costUsd: 0.31, tokens: { output_tokens: 900 }, durationMs: 4000, numTurns: 7, toolCalls: 2 },
    ]);
  });
  it("a stream that ends with no result is recorded as an error with nothing spent", async () => {
    const { run, rows } = recorded(fakeQuery([twoReads]));
    await expect(run).rejects.toThrow(/no result/);
    expect(rows).toMatchObject([{ outcome: "error", costUsd: 0, tokens: {}, numTurns: 0, toolCalls: 2 }]);
  });
  it("a success without the structured output the schema asked for is recorded as invalid", async () => {
    const { run, rows } = recorded(fakeQuery([result({ total_cost_usd: 0.2 })]), { schema: { type: "object" } });
    await expect(run).rejects.toThrow(/structured/);
    expect(rows).toMatchObject([{ outcome: "invalid", costUsd: 0.2 }]);
  });
  it("output the caller's check rejects is recorded as invalid and the check's error is the stage's", async () => {
    const { run, rows } = recorded(fakeQuery([result({ total_cost_usd: 0.2 })]), {
      accept: () => {
        throw new Error("0/3 articles extracted");
      },
    });
    await expect(run).rejects.toThrow("0/3 articles extracted");
    expect(rows).toMatchObject([{ outcome: "invalid", costUsd: 0.2 }]);
  });
  it("a call the cancellation signal aborted is recorded as a timeout", async () => {
    const ac = new AbortController();
    const aborting = (() =>
      (async function* () {
        yield twoReads;
        ac.abort("deadline");
        throw new Error("aborted");
      })()) as unknown as SdkQuery;
    const { run, rows } = recorded(aborting, { signal: ac.signal });
    await expect(run).rejects.toThrow(/aborted/);
    expect(rows).toMatchObject([{ outcome: "timeout", costUsd: 0, numTurns: 0, toolCalls: 2 }]);
  });
});

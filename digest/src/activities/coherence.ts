import type { UsageRow } from "../store/usage.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoherenceReportSchema, coherenceReportJsonSchema, type CoherenceReport } from "../contracts/coherence.js";
import { assertNoUrls, scrubUrls } from "../contracts/ids.js";
import { itemIds, normHeadline, resultMatches } from "../contracts/match.js";
import { parseAgentSpec } from "../runner/prompt.js";
import { runStage, type SdkQuery } from "../runner/run-stage.js";
import type { ArtifactStore, Pointer } from "../store/artifacts.js";
import type { StoryPlan } from "./index.js";
import type { DraftStory } from "./write.js";
import { recordOperatorNote } from "./operator-note.js";

export const COHERENCE_OUTPUT = "coherence_report.json";
export const DRAFT_OUTPUT = "draft_selections.json";

const STEP_1 = "1. Use the Read tool to read these files:";
const STEP_2 = "2. For each story in draft_selections.json";
const WRITE_STEP = /3\. Use the Write tool to write the result to `[^`]*coherence_report\.json`\n/;
const TOOLS_RULE = "- DO NOT use Bash. Use Read and Write tools only.\n";
const REPLY_JSON = "**Reply with the JSON object and nothing else** -- no preamble, no code fence, no commentary.\n";
export function buildInlineGrepBody(body: string, inputDir: string): string {
  if (!body.includes(STEP_1) || !body.includes(STEP_2) || !WRITE_STEP.test(body) || !body.includes(TOOLS_RULE))
    throw new Error("coherence body drifted: an instruction step is not where buildInlineGrepBody expects");
  const step1 = `1. **Your input arrives in the next message, inline**: draft_selections.json, every articles_*.csv, and article_fulltext.json. The same files are also on disk under \`${inputDir}/\`.\n`;
  let out = body.slice(0, body.indexOf(STEP_1)) + step1 + body.slice(body.indexOf(STEP_2));
  const step3 =
    "3. **Rule: before you FAIL a field, use the Grep tool (or Read) on the on-disk files to confirm the specific is absent from, or contradicted by, the story's cited sources.** A FAIL with no tool call behind it is not allowed; a PASS needs none.\n   " +
    REPLY_JSON;
  out = out.replace(WRITE_STEP, step3).replace(TOOLS_RULE, "- DO NOT use Bash or Write. Use Grep and Read only.\n");
  return out.replace("before writing that story's result", "before giving that story's result");
}

export function buildReadLoopBody(body: string): string {
  if (!WRITE_STEP.test(body) || !body.includes(TOOLS_RULE))
    throw new Error("coherence body drifted: the Write step or the tools rule is not where buildReadLoopBody expects");
  return body
    .replace(WRITE_STEP, "3. " + REPLY_JSON)
    .replace(TOOLS_RULE, "- DO NOT use Bash or Write. Use the Read tool only.\n")
    .replace("before writing that story's result", "before giving that story's result")
    .replaceAll("/app/data/claude_input/", "");
}
export type CheckerShape = "inline-grep" | "read-loop";

export function unbackedFails(report: CoherenceReport, toolCalls: { name: string; target: string }[]): number {
  const pats = toolCalls
    .filter((t) => t.name === "Grep" && t.target.trim().length >= 4)
    .map((t) => t.target.trim().toLowerCase());
  return report.results.filter((r) => !r.pass && !pats.some((p) => r.reason.toLowerCase().includes(p))).length;
}

export type Draft = { must_know: DraftStory[]; should_know: DraftStory[]; preheader: string };

export async function draftFrom(store: ArtifactStore, drafts: Pointer[]): Promise<Draft> {
  const out: Draft = { must_know: [], should_know: [], preheader: "" };
  const items: { plan: StoryPlan; story: DraftStory }[] = [];
  for (const d of drafts) items.push(JSON.parse(await store.get(d)) as { plan: StoryPlan; story: DraftStory });
  items.sort((a, b) => a.plan.index - b.plan.index);
  for (const { plan, story } of items) out[plan.tier].push(story);
  return out;
}

export function uncovered(report: CoherenceReport, draft: Draft): string[] {
  return [...draft.must_know, ...draft.should_know]
    .filter((s) => !report.results.some((r) => resultMatches(r, itemIds(s.sources), normHeadline(s.headline))))
    .map((s) => s.headline);
}

export interface CoherenceDeps {
  signal?: () => AbortSignal | undefined;
  store: ArtifactStore;
  agentsDir: string;
  query?: SdkQuery;
  heartbeat?: () => void;
  onUsage?: (row: UsageRow) => void | Promise<void>;
}

export function coherenceActivity(deps: CoherenceDeps) {
  return async (
    runId: number,
    drafts: Pointer[],
    _fulltext: Pointer,
    note?: string,
    force = false,
  ): Promise<Pointer> => {
    const { store } = deps;
    const draft = await draftFrom(store, drafts);
    const draftText = JSON.stringify(draft, null, 2);
    const existingDraft = await store.find(runId, DRAFT_OUTPUT);
    const sameDraft = existingDraft !== undefined && (await store.get(existingDraft)) === draftText;
    const existing = await store.find(runId, COHERENCE_OUTPUT);
    if (existing && sameDraft && !force) {
      const parsed = CoherenceReportSchema.safeParse(JSON.parse(await store.get(existing)));
      if (parsed.success && uncovered(parsed.data, draft).length === 0) return existing;
    }
    if (!force) {
      if (existing) await store.quarantine(runId, COHERENCE_OUTPUT);
      if (existingDraft && !sameDraft) await store.quarantine(runId, DRAFT_OUTPUT);
    }
    await recordOperatorNote(store, runId, "coherence", note);
    const checked = await runChecker(deps, runId, draftText, note);
    const { report: parsedReport, costUsd, durationMs, numTurns, toolCalls, unbacked } = checked;
    await deps.onUsage?.({
      model: checked.model,
      thinking: checked.thinking,
      prompt: checked.prompt,
      effort: checked.effort,
      tokens: checked.tokens,
      stage: "coherence",
      runId,
      costUsd,
      durationMs,
      numTurns,
      toolCalls,
      unbackedFails: unbacked,
    });
    const parsed = { data: parsedReport };
    const gaps = uncovered(parsed.data, draft);
    if (gaps.length)
      throw new Error(
        `coherence for run ${runId}: no result matches ${gaps.length} draft story(ies): ${gaps.slice(0, 3).join("; ")}`,
      );
    const write = (name: string, text: string) =>
      force ? store.replace(runId, name, text) : store.put(runId, name, text);
    if (force || !sameDraft) await write(DRAFT_OUTPUT, draftText);
    return write(COHERENCE_OUTPUT, JSON.stringify(parsed.data, null, 2));
  };
}

export async function runChecker(deps: CoherenceDeps, runId: number, draftText: string, note?: string) {
  const { store } = deps;
  const corpus: [string, string][] = [];
  for (const n of (await store.names(runId))
    .filter((x) => /^articles_\d+\.csv$/.test(x) || x === "article_fulltext.json")
    .toSorted())
    corpus.push([n, await store.content(runId, n)]);
  return checkDraft(deps, draftText, corpus, await store.runDate(runId), note, "read-loop", runId);
}

export async function checkDraft(
  deps: Pick<CoherenceDeps, "agentsDir" | "query" | "heartbeat" | "signal">,
  draftText: string,
  corpus: [string, string][],
  today: string,
  note?: string,
  shape: CheckerShape = "read-loop",
  runId?: number,
) {
  const dir = mkdtempSync(join(tmpdir(), "coherence-"));
  try {
    const parts: string[] = [];
    for (const [name, raw] of [[DRAFT_OUTPUT, draftText] as [string, string], ...corpus]) {
      const text = scrubUrls(raw);
      assertNoUrls(text);
      writeFileSync(join(dir, name), text);
      parts.push(`## ${name}\n\n${text}`);
    }
    const spec = parseAgentSpec(readFileSync(join(deps.agentsDir, "coherence.md"), "utf8"));
    const body = shape === "inline-grep" ? buildInlineGrepBody(spec.body, dir) : buildReadLoopBody(spec.body);
    deps.heartbeat?.();
    const message =
      shape === "inline-grep" ? parts.join("\n\n") : `The files are in your working directory, ${dir}. Begin.`;
    const sent = { ...spec, body, ...(shape === "read-loop" ? { tools: ["Read" as const] } : {}) };
    const r = await runStage(
      sent,
      { userMessage: message + (note ? `\n\nOperator note for this attempt: ${note}` : ""), inputDir: dir },
      {
        today,
        ...(runId === undefined ? {} : { runId }),
        outputSchema: coherenceReportJsonSchema(),
        ...(deps.query ? { query: deps.query } : {}),
        ...(deps.heartbeat ? { heartbeat: deps.heartbeat } : {}),
        ...(deps.signal?.() ? { signal: deps.signal()! } : {}),
      },
    );
    deps.heartbeat?.();
    const parsed = CoherenceReportSchema.safeParse(r.structured);
    if (!parsed.success) throw new Error("coherence: report does not match the schema");
    return {
      model: spec.model,
      thinking: spec.thinking,
      effort: r.effort,
      prompt: sent,
      tokens: r.usage,
      report: parsed.data,
      costUsd: r.costUsd,
      durationMs: r.durationMs,
      numTurns: r.numTurns,
      toolCalls: r.toolCalls.length,
      unbacked: shape === "inline-grep" ? unbackedFails(parsed.data, r.toolCalls) : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

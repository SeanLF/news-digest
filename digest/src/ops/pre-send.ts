import { leakedIds } from "../contracts/leaks.js";
import { SelectionsSchema, type Selections } from "../contracts/selections.js";
import type { RowOf, Sql } from "../store/db.js";
import { getRunHealth, violations } from "./run-health.js";

export const PRE_SEND_RULES: readonly string[] = [
  "BLANKED_WHY_IT_MATTERS",
  "STORIES_DROPPED_AT_WRITE",
  "REPAIR_SPEC_ERROR",
];
export const STORY_COUNT_RANGES = { must_know: [1, 6], should_know: [3, 14] } as const;

type DraftStory = { headline: string; sources: { article_id: string }[] };
export interface PreSendInput {
  selections: Selections;
  draft: { must_know: DraftStory[]; should_know: DraftStory[] } | null;
  threadContext: Record<string, { delta?: unknown }> | null;
  threadAuditFailures: number | null;
  healthViolations: string[];
}

const TIERS = ["must_know", "should_know"] as const;
const quote = (s: string) => `'${s.slice(0, 50).replaceAll("'", "\\'")}'`;

export function preSendFailures(i: PreSendInput): string[] {
  const { selections: sel } = i;
  const stories = TIERS.flatMap((tier) => sel[tier].map((s) => ({ tier, s })));
  const out: string[] = [];

  const leaks: string[] = [];
  const cited = stories.flatMap(({ s }) => s.sources.map((x) => x.article_id));
  leaks.push(...leakedIds(sel.preheader, cited).map((m) => `preheader ${quote(m)}`));
  for (const { tier, s } of stories) {
    const ids = s.sources.map((x) => x.article_id);
    const fields: [string, string][] = [
      ["headline", s.headline],
      ["summary", s.summary],
      ...(s.why_it_matters !== undefined ? [["why_it_matters", s.why_it_matters] as [string, string]] : []),
    ];
    for (const e of s.reporting_varies ?? [])
      for (const k of ["source", "angle", "bias"] as const) fields.push([`reporting_varies.${k}`, e[k]]);
    for (const c of s.claims ?? []) fields.push(["claims.text", c.text]);
    const shared = stories.filter((o) => o.s.cluster_id === s.cluster_id).length > 1;
    const delta = s.cluster_id !== undefined && !shared ? i.threadContext?.[s.cluster_id]?.delta : undefined;
    for (const [f, text] of fields)
      leaks.push(...leakedIds(text, ids).map((m) => `${tier}.${f} ${quote(m)} in ${quote(s.headline)}`));
    if (typeof delta === "string")
      leaks.push(...leakedIds(delta, ids).map((m) => `thread delta ${quote(m)} in ${quote(s.headline)}`));
  }
  if (leaks.length) out.push(`INTERNAL_ID_LEAK: ${leaks.length} leak(s): ${leaks.slice(0, 5).join(" | ")}`);

  const empty = stories.flatMap(({ tier, s }) =>
    (["headline", "summary"] as const).filter((f) => !s[f].trim()).map((f) => `${tier}.${f} in ${quote(s.headline)}`),
  );
  if (empty.length) out.push(`EMPTY_FIELD: ${empty.length} empty field(s): ${empty.slice(0, 8).join(", ")}`);

  const counts = TIERS.flatMap((tier) => {
    const [lo, hi] = STORY_COUNT_RANGES[tier];
    const n = sel[tier].length;
    return n < lo || n > hi ? [`${tier}=${n} not in [${lo},${hi}]`] : [];
  });
  if (counts.length) out.push(`STORY_COUNT: ${counts.join("; ")}`);

  if (i.draft) {
    const dropped = TIERS.flatMap((tier) => {
      const shipped = sel[tier].map((s) => new Set(s.sources.map((x) => x.article_id)));
      let next = 0;
      return i.draft![tier].filter((d) => {
        const ids = new Set(d.sources.map((x) => x.article_id));
        const s = shipped[next];
        if (s && s.size > 0 && [...s].every((a) => ids.has(a))) {
          next++;
          return false;
        }
        return true;
      });
    });
    if (dropped.length)
      out.push(
        `STORIES_DROPPED_AT_COHERENCE: ${dropped.length} story(ies) failed the fact-check, were not repaired, and were dropped: ${dropped
          .slice(0, 5)
          .map((d) => quote(d.headline))
          .join(" | ")}`,
      );
  }
  if (i.threadAuditFailures)
    out.push(
      `THREAD_AUDIT_FAILED: ${i.threadAuditFailures} thread update(s) shipped facts their audit could not check (it fails open)`,
    );
  out.push(...i.healthViolations.filter((v) => PRE_SEND_RULES.includes(v.split(":")[0]!)));
  return out;
}

const artifact = async (db: Sql, runId: number, name: string): Promise<unknown> => {
  const row = await db.one<Pick<RowOf<"artifacts">, "content">>(
    "SELECT content FROM artifacts WHERE run_id=$1 AND name=$2 AND status='current'",
    [runId, name],
  );
  return row ? (JSON.parse(row.content) as unknown) : null;
};

export async function readPreSend(
  db: Sql,
  runId: number,
  opts: { threadsEnabled: boolean; dormantAfter?: number },
): Promise<PreSendInput> {
  const raw = await artifact(db, runId, "selections.json");
  if (raw === null) throw new Error(`run ${runId} has no current selections.json to check`);
  const selections = SelectionsSchema.parse(raw);
  const draft = (await artifact(db, runId, "draft_selections.json")) as PreSendInput["draft"];
  const threadContext = (await artifact(db, runId, "thread_context.json")) as PreSendInput["threadContext"];
  const threadHealth = (await artifact(db, runId, "thread_health.json")) as { audit_failures?: unknown } | null;
  const auditFailures = threadHealth?.audit_failures;
  const health = await getRunHealth(db, runId, {
    broadcasting: true,
    threadsEnabled: opts.threadsEnabled,
    ...(opts.dormantAfter !== undefined ? { dormantAfter: opts.dormantAfter } : {}),
  });
  return {
    selections,
    draft,
    threadContext,
    threadAuditFailures: typeof auditFailures === "number" ? auditFailures : null,
    healthViolations: violations(health),
  };
}

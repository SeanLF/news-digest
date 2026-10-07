// A promptfoo JavaScript assertion for replay-provider.ts: scores the replay against the run's own
// artifact (replay-score.ts) and holds the scores to the experiment's pre-registered rule (vars.rule,
// bounds on named scores). A stage that failed fails, scored `failed: 1`; the rule bounds the rest.
import { breaches, score, type Rule } from "./replay-score.js";
import type { Mode } from "./stage-replay.js";

interface Out { mode: Mode; artifact: unknown; failure?: { error: string; prodOnFailure: string }; reference: unknown }

export default function replayAssert(output: string, context: { vars: { rule?: Rule | string } }) {
  const o = JSON.parse(output) as Out;
  const rule: Rule = typeof context.vars.rule === "string" ? (JSON.parse(context.vars.rule) as Rule) : (context.vars.rule ?? {});
  if (o.failure) {
    // Always a fail: a failed replay has nothing else to score, whatever the rule says about failures.
    return { pass: false, score: 0, reason: `stage failed: ${o.failure.error} (in a run: ${o.failure.prodOnFailure})`, namedScores: { failed: 1 } };
  }
  const { scores, missed, extra } = score(o.mode, o.artifact, o.reference);
  const all = { failed: 0, ...scores };
  const b = breaches(all, rule);
  const listed = [missed?.length ? `missed: ${missed.join(" | ")}` : "", extra?.length ? `extra: ${extra.join(" | ")}` : ""].filter(Boolean).join("; ");
  return { pass: b.length === 0, score: b.length === 0 ? 1 : 0, reason: `${b.length ? `breaches ${b.join(", ")}` : "within the rule"}${listed ? `; ${listed}` : ""}`, namedScores: all };
}

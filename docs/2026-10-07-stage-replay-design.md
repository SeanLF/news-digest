# Stage replay: direct calls under production's timeouts, not a Temporal job (2026-10-07, DECIDED)

## Question

`make replay` (2a0ec03) reruns one model stage (cluster, select, coherence, attribute) of a stored run
from its own artifacts, with a variant (model, effort, prompt), by calling the stage's activity directly.
Sean asked for it to be "as prod-like as can be" and to "re-use as much of it as possible", and whether
replays are "just temporal jobs … specific targets per job".

## Options

| | A: direct calls | B: `StageReplayWorkflow`, one Worker per target in one process | C: DigestWorkflow with a stop-after-stage input | D: B's workflow, one worker container per target |
|---|---|---|---|---|
| Stage code, prompts, runner, SDK | same | same | same | same |
| Retries | none (one attempt) | the run's (model: 3 attempts, 5 then 10 min apart) | the run's | the run's |
| Timeouts | none before this change | the run's | the run's | the run's |
| Production files touched | none | proxies moved out of digest.workflow.ts, real.ts env parameter | replay branches inside DigestWorkflow | proxies moved |

## Decision: A, with production's start-to-close per activity and failures reported as results

The review (adversarial, 2026-10-07) refuted B on the premise:

- **The stage code never looks at Temporal.** No `Context.current`, `activityInfo` or attempt number in
  the four stages' activities or the runner. On every call that succeeds, A and B produce the same output
  from the same distribution. B differs only when a call fails, and there it retries and reports success.
- **That hides what a variant comparison measures.** A Haiku SELECT that fails one call in three would come
  back from B as a success that took 15 minutes. A counts the failure.
- **The draft's case against A was false.** It said A "would have retried COHERENCE, which production
  never does"; A has no retries at all, and COHERENCE and ATTRIBUTE are one-attempt stages in production too.
- **A's one real gap was a missing timeout**: outside an activity there is no cancellation signal, and the
  runner has no deadline of its own, so a hung CLI call hung the replay.

So: each replay runs under the stage's own start-to-close from the workflow (45 min per model call; 10 min
for attribute's whole activity), held to `digest.workflow.ts` by `gate/stage-replay.test.ts`. A failure is
written as a result with what a run would have done (`retried up to 3 attempts … then parks`, `lost batch`,
`ships without attribution`), so a comparison counts failure rates instead of retrying them away.

Not reproduced, by design: retries, operator notes, an operator's retry of a parked run, the run's deadline.
When the question is "does the issue survive this change end to end", that is `make band`.

Runner (same day, later): a promptfoo provider (`gate/replay-provider.ts`), not the hand-rolled
`bin/replay` 2a0ec03 added. promptfoo already runs variants side by side, repeats, runs in parallel
and compares; the provider adds a scratch database per call and a bound on model calls in flight, and
`replay-assert.ts` scores against the run's own artifact under the experiment's pre-registered rule.

## Not chosen, and why

- **B**: no change in output on success, hides failures, and moves production workflow code for an eval tool.
- **C**: the most faithful, but puts replay branches into the production workflow.
- **D**: B's fidelity without the in-process complexity; still hides failures behind retries.

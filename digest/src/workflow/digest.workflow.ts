import {
  ActivityFailure,
  ApplicationFailure,
  CancellationScope,
  CancelledFailure,
  condition,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type {
  Activities,
  AlertRequest,
  DigestInput,
  DigestOutput,
  FulltextFetch,
  FulltextFetcher,
  GnewsDecode,
  LinkDecoder,
} from "../activities/index.js";
import { isCutoverHold } from "../ops/cutover-hold.js";
import { mapBounded, MODEL_FANOUT_LIMIT } from "./bounded.js";
import {
  MODEL_MAX_ATTEMPTS,
  NETWORK_MAX_ATTEMPTS,
  OPS_MAX_ATTEMPTS,
  PYTHON_TASK_QUEUE,
  RUN_TIMEOUT_HOURS,
  WEEKLY_RECAP_MAX_ATTEMPTS,
} from "./policy.js";
import { approveSignal, operatorNoteSignal, retrySignal } from "./signals.js";
import { threadsPhase } from "./threads.js";

export const WORKFLOW_RUN_TIMEOUT = `${RUN_TIMEOUT_HOURS} hours` as const;
export const RUN_DEADLINE_MS = 230 * 60 * 1000;
export const DEADLINE_MARGIN_MS = 10 * 60 * 1000;
export const HOLD_TIMEOUT = 15 * 60 * 1000;
export const TAIL_MARGIN_MS = 30 * 60 * 1000;

function deadlineMs(): number {
  const { runTimeoutMs } = workflowInfo();
  return runTimeoutMs
    ? Math.max(60_000, Math.min(RUN_DEADLINE_MS, runTimeoutMs - DEADLINE_MARGIN_MS))
    : RUN_DEADLINE_MS;
}
function sendBudget(): number {
  return workflowInfo().runStartTime.getTime() + deadlineMs() - TAIL_MARGIN_MS - Date.now();
}
export const workflowIdFor = (runDate: string): string => `digest-${runDate}`;

const model = proxyActivities<Activities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: MODEL_MAX_ATTEMPTS, initialInterval: "5 minutes", backoffCoefficient: 2 },
});
const network = proxyActivities<Activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: NETWORK_MAX_ATTEMPTS, initialInterval: "10 seconds" },
});
const once = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 1 } });
const rebuild = proxyActivities<Activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: NETWORK_MAX_ATTEMPTS, initialInterval: "10 seconds" },
});
const send = proxyActivities<Activities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});
const record = proxyActivities<Activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: NETWORK_MAX_ATTEMPTS, initialInterval: "10 seconds" },
});
const attributing = proxyActivities<Activities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});
const verdict = proxyActivities<Activities>({
  startToCloseTimeout: "45 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: 1 },
});
const python = proxyActivities<FulltextFetcher>({
  taskQueue: PYTHON_TASK_QUEUE,
  scheduleToStartTimeout: "5 minutes",
  startToCloseTimeout: "4 minutes",
  retry: { maximumAttempts: 2 },
});
const decoder = proxyActivities<LinkDecoder>({
  startToCloseTimeout: "6 minutes",
  heartbeatTimeout: "3 minutes",
  retry: { maximumAttempts: 1 },
});
const ops = proxyActivities<Activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: OPS_MAX_ATTEMPTS, initialInterval: "10 seconds" },
});
const TAIL_ATTEMPT_MS = 60_000;
const TAIL_ATTEMPTS = 2;
const TAIL_RETRY_MS = 5_000;
const tail = proxyActivities<Activities>({
  startToCloseTimeout: TAIL_ATTEMPT_MS,
  retry: { maximumAttempts: TAIL_ATTEMPTS, initialInterval: TAIL_RETRY_MS, maximumInterval: TAIL_RETRY_MS },
});
export const NOTIFY_MS = 60_000;
const notify = proxyActivities<Activities>({ startToCloseTimeout: NOTIFY_MS, retry: { maximumAttempts: 1 } });
const SEND_MS = 10 * 60 * 1000;
const OPS_WORST_MS = 3 * 2 * 60 * 1000 + 30_000;
export const TAIL_WORST_CASE_MS =
  SEND_MS + 5 * (TAIL_ATTEMPTS * TAIL_ATTEMPT_MS + (TAIL_ATTEMPTS - 1) * TAIL_RETRY_MS) + OPS_WORST_MS;
const weekly = proxyActivities<Activities>({
  startToCloseTimeout: "5 minutes",
  heartbeatTimeout: "2 minutes",
  retry: { maximumAttempts: WEEKLY_RECAP_MAX_ATTEMPTS, initialInterval: "10 seconds" },
});

async function bestEffort<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    if (isCancellation(e)) throw e;
    return undefined;
  }
}
const causes = (e: unknown): string => {
  const parts: string[] = [];
  for (let c: unknown = e; c instanceof Error && parts.length < 5; c = c.cause) parts.push(c.message);
  return parts.join(" <- ") || String(e);
};

interface RunState {
  runId: number | null;
  sent: boolean;
}

export async function DigestWorkflow(input: DigestInput): Promise<DigestOutput> {
  const state: RunState = { runId: null, sent: false };
  try {
    return await CancellationScope.withTimeout(deadlineMs(), () => runDigest(input, state));
  } catch (e) {
    if (CancellationScope.current().consideredCancelled) throw e;
    const timedOut = isCancellation(e);
    const failure = timedOut
      ? ApplicationFailure.nonRetryable(`run deadline of ${deadlineMs() / 60_000} minutes exceeded`, "RunDeadline")
      : e;
    await CancellationScope.nonCancellable(async () => {
      if (state.sent)
        await bestEffort(() =>
          ops.healthcheck("success", `sent, but the run failed after the send: ${causes(failure)}`),
        );
      else if (input.resumeRun === undefined) await bestEffort(() => ops.healthcheck("fail"));
      await bestEffort(() =>
        ops.alert({
          kind: "run-failed",
          workflowId: workflowInfo().workflowId,
          runId: state.runId,
          reason: causes(failure),
          timedOut,
          sent: state.sent,
        }),
      );
    });
    throw failure;
  }
}

async function runDigest(input: DigestInput, state: RunState): Promise<DigestOutput> {
  let approval: "approve" | "reject" | undefined;
  const approvalNow = () => approval;
  const retryDecisions: ("retry" | "abort")[] = [];
  const notes: Record<string, string> = {};
  setHandler(approveSignal, ({ decision }) => {
    approval = decision;
  });
  setHandler(retrySignal, ({ decision }) => {
    retryDecisions.push(decision);
  });
  setHandler(operatorNoteSignal, ({ stage, note }) => {
    notes[stage] = note;
  });

  const { runId, sourceIds, lastRun } = await once.startRun(input);
  state.runId = runId;
  const monitored = input.resumeRun === undefined;
  if (monitored) await bestEffort(() => ops.healthcheck("start"));

  async function alertOn(check: () => Promise<AlertRequest | null>): Promise<void> {
    const req = await bestEffort(check);
    if (req) await bestEffort(() => ops.alert(req));
  }
  const notSent = (reason: "disabled" | "held-out", detail: string) =>
    alertOn(() => Promise.resolve({ kind: "not-sent", workflowId: workflowInfo().workflowId, runId, reason, detail }));
  async function finish(out: Omit<DigestOutput, "runId">): Promise<DigestOutput> {
    if (out.broadcast !== "sent") await bestEffort(() => tail.threadsRetract(runId));
    await tail.finishRun(runId, out);
    if (out.broadcast === "sent") await bestEffort(() => tail.healthcheck("success"));
    else if (monitored && (out.broadcast === "rejected" || out.broadcast === "skipped"))
      await bestEffort(() =>
        tail.healthcheck(
          "success",
          `not sent: ${out.broadcast === "rejected" ? "rejected" : "aborted"} by the operator`,
        ),
      );
    else if (out.broadcast === "held-out") await bestEffort(() => tail.healthcheck("fail"));
    if (out.broadcast === "sent") await alertOn(() => tail.checkRunHealth(runId, true));
    return { runId, ...out };
  }

  try {
    async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
      for (;;) {
        try {
          return await fn();
        } catch (e) {
          if (!(e instanceof ActivityFailure) || e.cause instanceof CancelledFailure) throw e;
          await condition(() => retryDecisions.length > 0);
          if (retryDecisions.shift() === "abort") return undefined;
        }
      }
    }

    const fetched = (await Promise.allSettled(sourceIds.map((s) => network.fetchFeed(runId, s, lastRun)))).flatMap(
      (r) => (r.status === "fulfilled" ? [r.value] : []),
    );
    await alertOn(() => ops.checkFeeds(runId, sourceIds));
    const { articles } = await once.prepare(runId, fetched, input.force);
    await bestEffort(() => ops.healthcheckLog(`curation start: run ${runId}`));
    const weeklyP = bestEffort(() => weekly.weeklyRecap(runId, input.force));
    weeklyP.catch(() => undefined);
    const recapP = model.recap(runId, input.force);
    const { batches } = await once.planBatches(runId, articles);
    const settled = await mapBounded(batches, MODEL_FANOUT_LIMIT, (b) => model.extractBatch(runId, b, input.force));
    const tagBatches = settled.map((s) => (s.status === "fulfilled" ? s.value : null));
    const [clusters, recap] = await Promise.all([once.joinClusters(runId, tagBatches, input.force), recapP]);
    await weeklyP;
    const selected = await guarded(() => model.select(runId, clusters, recap, notes["select"], input));
    if (!selected) return await finish({ stories: 0, broadcast: "skipped" });
    const plan = await once.planFulltext(runId, selected, input.force);
    const fetch = async (): Promise<FulltextFetch> => {
      if (plan.skip) return { tasks: 0, results: {}, outcome: plan.skip };
      return python.fetchFulltext(plan.tasks).catch((e: unknown): FulltextFetch => {
        if (isCancellation(e)) throw e;
        return { tasks: plan.tasks.length, results: {}, outcome: "unavailable" };
      });
    };
    if (!plan.existing) await once.storeFulltext(runId, await fetch(), input.force);
    const { plans } = await once.planStories(runId, selected, clusters);
    const storyCount = plans.length;
    const written = await mapBounded(plans, MODEL_FANOUT_LIMIT, (p) =>
      model.writeStory(runId, p, selected, notes["write"], input.force),
    );
    const failed = written.find((w) => w.status === "rejected");
    if (failed) throw failed.reason;
    const drafts = written.flatMap((w) => (w.status === "fulfilled" ? [w.value] : []));
    const preheaderP = model.preheader(runId, drafts, input.force).catch((e: unknown) => {
      if (isCancellation(e)) throw e;
      return null;
    });
    preheaderP.catch(() => undefined);
    const topup = await once.planFulltextTopup(runId, drafts, input.force);
    const fetchTopup = async (): Promise<FulltextFetch> => {
      if (topup.skip) return { tasks: 0, results: {}, outcome: topup.skip };
      return python.fetchFulltext(topup.tasks).catch((e: unknown): FulltextFetch => {
        if (isCancellation(e)) throw e;
        return { tasks: topup.tasks.length, results: {}, outcome: "unavailable" };
      });
    };
    const checked = topup.existing ?? (await once.storeFulltextTopup(runId, await fetchTopup(), input.force));
    const report = await guarded(() => verdict.coherence(runId, drafts, checked, notes["coherence"], input.force));
    const preheader = await preheaderP;
    if (!report) return await finish({ stories: 0, broadcast: "skipped" });
    const repair = await model.repair(runId, drafts, report, input.force);
    const attribution = await attributing.attribute(runId, drafts, report, repair, input.force).catch((e: unknown) => {
      if (isCancellation(e)) throw e;
      log.warn("attribution failed; the issue goes on without it", { runId, error: String(e) });
      return null;
    });
    const selections = await rebuild.assemble(runId, drafts, report, repair, preheader, attribution, input.force);
    const decodeLinks = async () => {
      const links = await once.planGnews(runId, selections, input.force);
      if (links.existing) return links.existing;
      const decoded = links.skip
        ? { links: 0, decoded: {}, attempted: 0, outcome: links.skip }
        : await decoder.decodeLinks(links.urls).catch((e: unknown): GnewsDecode => {
            if (isCancellation(e)) throw e;
            return { links: links.urls.length, decoded: {}, attempted: 0, outcome: "failed" };
          });
      return once.storeGnews(runId, decoded, input.force);
    };
    const [gnews, threads] = await Promise.all([decodeLinks(), threadsPhase(runId, input.force)]);

    await record.archiveRun(runId, selections, clusters).catch((e: unknown) => {
      if (isCancellation(e)) throw e;
      log.warn("archiving the run's selections and clusters failed; the issue goes on", { runId, error: String(e) });
    });
    const { html, email } = await rebuild.render(runId, selections, threads, gnews);
    const failures = await record.checkPreSend(runId).catch((e: unknown): string[] => {
      if (isCancellation(e)) throw e;
      return [`PRE_SEND_CHECK_ERROR: the checks could not run: ${causes(e)}`];
    });
    const failedChecks = failures.filter((f) => !isCutoverHold(f));
    if (failedChecks.length) log.warn("pre-send checks failed", { runId, failures: failedChecks });
    if (failures.length > failedChecks.length) log.info("the cut-over hold is on", { runId });

    if (!(await record.sendEnabled())) {
      log.warn("BROADCAST_ENABLED is not true: nothing published, sent or recorded as shown", { runId });
      await notSent(
        "disabled",
        `broadcasting disabled on this worker${failedChecks.length ? `; the pre-send checks failed: ${failedChecks.join("; ")}` : ""}`,
      );
      return await finish({ stories: storyCount, broadcast: "disabled" });
    }
    if (approval === "reject") return await finish({ stories: storyCount, broadcast: "rejected" });
    const budget = sendBudget();
    if (budget <= 0) {
      log.warn("no run budget left for the send; not sending", { runId, budgetMs: budget });
      await notSent(
        "held-out",
        `the run reached the send ${Math.ceil(-budget / 60_000)} minute(s) after the last moment its send and record fit before the deadline`,
      );
      return await finish({ stories: storyCount, broadcast: "held-out" });
    }
    if (failures.length) {
      const holdEnds = Date.now() + Math.min(HOLD_TIMEOUT, budget);
      await notify.notifyHold(runId, selections, new Date(holdEnds).toISOString(), failures).catch((e: unknown) => {
        if (isCancellation(e)) throw e;
        log.warn("the hold notification failed; holding anyway", { runId, error: String(e) });
      });
      const left = holdEnds - Date.now();
      if (left > 0) await condition(() => approval !== undefined, left);
      if (approvalNow() === "reject") return await finish({ stories: storyCount, broadcast: "rejected" });
    }
    return await CancellationScope.nonCancellable(async () => {
      await tail.saveDigest(runId, html, selections);
      const sent = await send.broadcast(runId, email);
      state.sent = true;
      await tail.recordShownHeadlines(runId, selections);
      return await finish({ stories: storyCount, broadcast: "sent", recipients: sent.recipients });
    });
  } catch (e) {
    await CancellationScope.nonCancellable(() =>
      record.abortRun(
        runId,
        e instanceof Error
          ? `${e.name}: ${e.message}${e.cause instanceof Error ? ` (${e.cause.message})` : ""}`
          : String(e),
      ),
    );
    throw e;
  }
}

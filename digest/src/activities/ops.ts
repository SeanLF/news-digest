import { Context } from "@temporalio/activity";
import { log } from "../log.js";
import { emailSender, resendClient, type SendEmail } from "../mail/resend.js";
import { sendAlert, type AlertRequest } from "../ops/alerts.js";
import { broadcastState } from "../ops/broadcast-state.js";
import { feedHealthAlert } from "../ops/feed-health.js";
import { groundRun } from "../ops/grounding-run.js";
import { type Healthcheck, healthcheck } from "../ops/healthcheck.js";
import { cutoverHold } from "../ops/cutover-hold.js";
import { preSendFailures, readPreSend } from "../ops/pre-send.js";
import { coherenceKindCounts, getRunHealth, threadsEnabled, violations } from "../ops/run-health.js";
import { runDateIn } from "../store/artifacts.js";
import { openDb, type RowOf, type Sql } from "../store/db.js";
import type { Track } from "../telemetry.js";
import { threadsConfigFrom } from "./threads.js";

export interface OpsDeps {
  dbUrl: string;
  env: Record<string, string | undefined>;
  maxAttempts: number;
  send?: SendEmail;
  fetch?: typeof fetch;
  healthcheck?: Healthcheck;
  track?: Track;
  sourceNames?: ReadonlyMap<string, string>;
}

const activityInfo = (): { attempt: number; key?: string } => {
  try {
    const { attempt, activityId, workflowExecution: wf } = Context.current().info;
    return { attempt, key: wf ? `${wf.workflowId}/${wf.runId}/${activityId}` : activityId };
  } catch {
    return { attempt: Number.POSITIVE_INFINITY };
  }
};

export function opsActivities(deps: OpsDeps) {
  const reportGrounding = async (db: Sql, runId: number): Promise<void> => {
    try {
      const report = await groundRun(db, runId, deps.sourceNames ?? new Map());
      if (!report) return;
      if (report.unsupported.length)
        log.warn({ stage: "grounding", runId, checked: report.checked, unsupported: report.unsupported });
      deps.track?.("digest_grounding", {
        run_id: runId,
        stories: report.stories,
        checked: report.checked,
        unsupported: report.unsupported.length,
        names_unchecked: report.namesUnchecked.reduce((n, r) => n + r.names, 0),
      });
    } catch (e) {
      log.error(`grounding check FAILED to run for run ${runId} (non-fatal): ${String(e)}`);
    }
  };
  const hc = deps.healthcheck ?? healthcheck(deps.env, deps.fetch);
  const send: SendEmail =
    deps.send ??
    ((email, opts) => emailSender(resendClient(deps.env["RESEND_API_KEY"] ?? "", {}, deps.env).emails)(email, opts));
  return {
    healthcheck: (event: "start" | "success" | "fail", note?: string): Promise<void> =>
      hc.ping(event === "success" ? undefined : event, note),
    healthcheckLog: (message: string): Promise<void> => hc.log(message),

    checkFeeds: async (runId: number, sourceIds: string[]): Promise<AlertRequest | null> => {
      try {
        return await feedHealthAlert(
          openDb(deps.dbUrl),
          runId,
          sourceIds,
          Number(deps.env["HEALTH_ALERT_THRESHOLD"] ?? 3),
        );
      } catch (e) {
        log.error(`feed-health check FAILED to run for run ${runId} (non-fatal): ${String(e)}`);
        return null;
      }
    },

    checkRunHealth: async (runId: number, broadcasting: boolean): Promise<AlertRequest | null> => {
      try {
        const db = openDb(deps.dbUrl);
        const report = await db.one<Pick<RowOf<"artifacts">, "content">>(
          "SELECT content FROM artifacts WHERE run_id=$1 AND name='coherence_report.json' AND status='current'",
          [runId],
        );
        const kinds = coherenceKindCounts(report?.content);
        if (kinds) log.info({ stage: "coherence", runId, failureKinds: kinds });
        const health = await getRunHealth(db, runId, {
          broadcasting,
          threadsEnabled: threadsEnabled(deps.env),
          dormantAfter: threadsConfigFrom(deps.env).dormantAfter,
        });
        if (health.stale_figures) log.warn({ stage: "attribute", runId, staleFigures: health.stale_figures });
        await reportGrounding(db, runId);
        if (health.dropped_continuations)
          log.warn(
            `Run ${runId}: ${health.dropped_continuations} story/stories lost a proposed thread continuation to one already claimed this run, and shipped as new threads`,
          );
        const found = violations(health);
        if (!found.length) return null;
        log.error(`Run ${runId} violated post-run invariants: ${found.join("; ")}`);
        return { kind: "run-health", runId, violations: found };
      } catch (e) {
        log.error(`run-health check FAILED to run for run ${runId} (non-fatal): ${String(e)}`);
        return null;
      }
    },

    checkPreSend: async (runId: number): Promise<string[]> => {
      const db = openDb(deps.dbUrl);
      const input = await readPreSend(db, runId, {
        threadsEnabled: threadsEnabled(deps.env),
        dormantAfter: threadsConfigFrom(deps.env).dormantAfter,
      });
      const cutover = cutoverHold(deps.env, await runDateIn(db, runId));
      const failures = [...(cutover ? [cutover] : []), ...preSendFailures(input)];
      log.info({ stage: "pre-send", runId, failures });
      return failures;
    },

    alert: async (request: AlertRequest): Promise<void> => {
      const { attempt, key } = activityInfo();
      let req = request;
      if (req.kind === "run-failed" && req.runId !== null) {
        const runId = req.runId;
        try {
          const day = await broadcastState(
            openDb(deps.dbUrl),
            runId,
            /^digest-(\d{4}-\d{2}-\d{2})$/.exec(req.workflowId)?.[1],
          );
          if (day) req = { ...req, broadcastStatus: day.status, date: day.date };
        } catch (e) {
          log.error(`could not read the day's broadcast state for run ${runId}: ${String(e)}`);
        }
      }
      await sendAlert(req, {
        env: deps.env,
        send,
        attempt,
        maxAttempts: deps.maxAttempts,
        ...(key ? { idempotencyKey: key } : {}),
      });
    },
  };
}

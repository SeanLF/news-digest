import { readFileSync } from "node:fs";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { NETWORK_MAX_ATTEMPTS } from "../workflow/policy.js";
import { parse } from "csv-parse/sync";
import { activeSources, newerThan, parseArticles, type CatalogueSource } from "../fetch/feeds.js";
import { fetchBounded, type BoundedResponse } from "../fetch/safe-fetch.js";
import { log } from "../log.js";
import { toCsv, type Fetched } from "../prepare/prepare.js";
import type { ArtifactStore } from "../store/artifacts.js";
import { openDb, type RowOf, type Sql } from "../store/db.js";
import type { Track } from "../telemetry.js";
import type { DigestInput, DigestOutput } from "./index.js";
import { EMAIL_OUTPUT } from "./render.js";

export const SOURCES_HEADER = ["id", "name", "bias", "factuality", "perspective"] as const;
export const FETCH_TIMEOUT_MS = 15_000;
export const FEED_MAX_BYTES = 5 * 2 ** 20;
const getFeed = (url: string): Promise<BoundedResponse> =>
  fetchBounded(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: FEED_MAX_BYTES,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
const SENT = "id IN (SELECT run_id FROM sent_runs)";
const lastSent = async (db: Sql, before?: string): Promise<string | null> =>
  (before
    ? await db.one<{ t: string | null }>(`SELECT MAX(started_at) AS t FROM runs WHERE ${SENT} AND started_at < $1`, [
        before,
      ])
    : await db.one<{ t: string | null }>(`SELECT MAX(started_at) AS t FROM runs WHERE ${SENT}`))!.t;

export interface RunDeps {
  store: ArtifactStore;
  dbUrl: string;
  sourcesFile: string;
  get?: (url: string) => Promise<Pick<BoundedResponse, "status" | "body">>;
  maxAttempts?: number;
  track?: Track;
}

const currentAttempt = (): number => {
  try {
    return Context.current().info.attempt;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const currentExecution = (): { workflowId: string; runId: string } | undefined => {
  try {
    return Context.current().info.workflowExecution;
  } catch {
    return undefined;
  }
};

const recordAttempt = (db: Sql, runId: number, execution: { workflowId: string; runId: string }, forced: boolean) =>
  db.run(
    "INSERT INTO run_attempts (run_id, pipeline, workflow_id, workflow_run_id, git_sha, is_forced) VALUES ($1, 'temporal', $2, $3, $4, $5) ON CONFLICT (workflow_run_id) DO NOTHING",
    [runId, execution.workflowId, execution.runId, process.env["GIT_SHA"] ?? null, forced],
  );

export async function endAttempt(
  db: Sql,
  runId: number,
  status: "completed" | "failed",
  error: string | null = null,
): Promise<boolean> {
  const execution = currentExecution();
  const where = execution
    ? "workflow_run_id = $3"
    : "id = (SELECT max(id) FROM run_attempts WHERE run_id = $3::bigint)";
  return (
    0 <
    (await db.run(
      `UPDATE run_attempts SET status = $1, error = COALESCE($2, error), ended_at = now() WHERE ${where} AND status = 'running'`,
      [status, error, execution ? execution.runId : runId],
    ))
  );
}

export function runActivities(deps: RunDeps) {
  const catalogue = (): CatalogueSource[] => activeSources(JSON.parse(readFileSync(deps.sourcesFile, "utf8")));
  const db = () => openDb(deps.dbUrl);
  const sourceIds = async (runId: number): Promise<string[]> => {
    const csv = await deps.store.find(runId, "sources.csv");
    if (csv) return parse<{ id: string }>(await deps.store.get(csv), { columns: true }).map((s) => s.id);
    const sources = catalogue();
    await deps.store.put(
      runId,
      "sources.csv",
      toCsv(
        SOURCES_HEADER,
        sources.map((s) => [s.id, s.name, s.bias, s.factuality, s.perspective]),
      ),
    );
    return sources.map((s) => s.id);
  };
  return {
    startRun: async (input: DigestInput): Promise<{ runId: number; sourceIds: string[]; lastRun: string | null }> => {
      const execution = currentExecution();
      if (input.resumeRun !== undefined) {
        const resumed = input.resumeRun;
        const row = await db().one<Pick<RowOf<"runs">, "started_at">>("SELECT started_at FROM runs WHERE id=$1", [
          resumed,
        ]);
        if (!row) throw ApplicationFailure.nonRetryable(`no run ${resumed} to resume`, "BadInput");
        const csv = await deps.store.find(resumed, "sources.csv");
        if (!csv)
          throw ApplicationFailure.nonRetryable(`run ${resumed} has no sources.csv to resume from`, "MissingInput");
        const ids = parse<{ id: string }>(await deps.store.get(csv), { columns: true }).map((s) => s.id);
        if (execution !== undefined)
          await db().tx(async (t) => {
            await t.run(`UPDATE runs SET status = 'running', outcome = NULL WHERE id = $1 AND NOT ${SENT}`, [resumed]);
            await recordAttempt(t, resumed, execution, input.force ?? false);
          });
        return { runId: resumed, sourceIds: ids, lastRun: await lastSent(db(), row.started_at) };
      }
      const own =
        execution === undefined
          ? undefined
          : await db().one<{ id: number }>("SELECT run_id AS id FROM run_attempts WHERE workflow_run_id = $1", [
              execution.runId,
            ]);
      const lastRun = await lastSent(db());
      if (own) return { runId: own.id, sourceIds: await sourceIds(own.id), lastRun };
      const runId = await db().tx(async (t) => {
        const mine =
          execution === undefined
            ? undefined
            : await t.one<{ id: number }>("SELECT run_id AS id FROM run_attempts WHERE workflow_run_id = $1", [
                execution.runId,
              ]);
        if (mine) return mine.id;
        if (!input.force) {
          const clash = await t.one<{ id: number; status: string; day: string }>(
            `SELECT id, status, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM runs WHERE (started_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date AND (${SENT} OR (status = 'running' AND started_at >= now() - interval '4 hours')) ORDER BY id DESC LIMIT 1`,
          );
          if (clash)
            throw ApplicationFailure.nonRetryable(
              `${clash.day} already has run ${clash.id} (${clash.status}); start with force to run it again`,
              "AlreadyRan",
            );
        }
        const inserted = await t.one<Pick<RowOf<"runs">, "id">>("INSERT INTO runs (git_sha) VALUES ($1) RETURNING id", [
          process.env["GIT_SHA"] ?? null,
        ]);
        if (execution !== undefined) await recordAttempt(t, inserted!.id, execution, input.force ?? false);
        return inserted!.id;
      }, "startRun");
      return { runId, sourceIds: await sourceIds(runId), lastRun };
    },

    fetchFeed: async (
      runId: number,
      sourceId: string,
      lastRun: string | null,
    ): Promise<{ sourceId: string; ok: boolean; fetched: number; kept: number; error?: string }> => {
      const health = await db().one<{ ok: boolean; error: string | null; fetched: number; kept: number }>(
        "SELECT is_success AS ok, error, articles_fetched AS fetched, articles_kept AS kept FROM source_fetches WHERE run_id=$1 AND source_id=$2",
        [runId, sourceId],
      );
      if (health)
        return {
          sourceId,
          ok: health.ok,
          fetched: health.fetched,
          kept: health.kept,
          ...(health.error ? { error: health.error } : {}),
        };
      const source = catalogue().find((s) => s.id === sourceId);
      if (!source) throw ApplicationFailure.nonRetryable(`${sourceId} is not an active source`, "BadInput");
      let body: string;
      try {
        const res = await (deps.get ?? getFeed)(source.url);
        if (res.status < 200 || res.status > 299) throw new Error(`HTTP ${res.status}`);
        body = res.body;
      } catch (e) {
        if (currentAttempt() < (deps.maxAttempts ?? NETWORK_MAX_ATTEMPTS)) throw e;
        const error = `Failed after ${deps.maxAttempts ?? NETWORK_MAX_ATTEMPTS} attempts: ${String(e).slice(0, 200)}`;
        await db().run(
          "INSERT INTO source_fetches (source_id, is_success, error, articles_fetched, articles_kept, run_id) VALUES ($1, false, $2, 0, 0, $3)",
          [sourceId, error, runId],
        );
        return { sourceId, ok: false, fetched: 0, kept: 0, error };
      }
      let articles: Fetched[];
      let error: string | undefined;
      try {
        articles = parseArticles(body);
      } catch (e) {
        articles = [];
        error = `Feed parse error: ${String(e).slice(0, 200)}`;
      }
      const kept = newerThan(articles, lastRun);
      await db().tx(async (t) => {
        for (const a of kept)
          await t.run(
            "INSERT INTO articles (run_id, source_id, title, url, published_raw, summary) VALUES ($1, $2, $3, $4, $5, $6)",
            [runId, sourceId, a.title, a.url, a.published, a.summary],
          );
        await t.run(
          "INSERT INTO source_fetches (source_id, is_success, error, articles_fetched, articles_kept, run_id) VALUES ($1, $2, $3, $4, $5, $6)",
          [sourceId, !error, error ?? null, articles.length, kept.length, runId],
        );
      });
      return { sourceId, ok: !error, fetched: articles.length, kept: kept.length, ...(error ? { error } : {}) };
    },

    finishRun: async (runId: number, out: Omit<DigestOutput, "runId">): Promise<void> => {
      const closed = await db().tx(async (t) => {
        if (out.broadcast === "sent")
          await t.run(
            "UPDATE runs SET status='completed', outcome='sent', articles_kept=(SELECT SUM(articles_kept) FROM source_fetches WHERE run_id=$1) WHERE id=$1",
            [runId],
          );
        else
          await t.run(
            "UPDATE runs SET status='completed', outcome=$1 WHERE id=$2 AND outcome IS DISTINCT FROM 'sent'",
            [out.broadcast, runId],
          );
        return endAttempt(t, runId, "completed");
      });
      if (closed)
        await tellEnding(deps.track, db(), runId, {
          outcome: out.broadcast,
          stories: out.stories,
          recipients: out.recipients,
        });
    },
  };
}

export async function tellEnding(
  track: Track | undefined,
  db: Sql,
  runId: number,
  fields: Record<string, unknown>,
  event = "digest_run_finished",
): Promise<void> {
  if (!track) return;
  try {
    const r = await db.one<{
      articles_kept: number | null;
      cost_usd: number | null;
      duration_s: number | null;
      email_bytes: number | null;
    }>(
      `SELECT r.articles_kept, (SELECT sum(api_cost_usd) FROM model_calls WHERE run_id = r.id) AS cost_usd, extract(epoch FROM now() - r.started_at)::float AS duration_s,
         (SELECT octet_length(content) FROM artifacts WHERE run_id = r.id AND name = $2 AND status = 'current') AS email_bytes
       FROM runs r WHERE r.id = $1`,
      [runId, EMAIL_OUTPUT],
    );
    track(event, {
      run_id: runId,
      ...fields,
      articles_kept: r?.articles_kept ?? null,
      cost_usd: r?.cost_usd ?? null,
      duration_s: r?.duration_s ?? null,
      email_bytes: r?.email_bytes ?? null,
      git_sha: process.env["GIT_SHA"] ?? null,
    });
  } catch (e) {
    log.warn({ stage: "telemetry", warning: `${event} not sent`, runId, error: String(e) });
  }
}

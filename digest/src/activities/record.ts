import { ApplicationFailure } from "@temporalio/common";
import { resolveArticleIds, type Selections } from "../render/render.js";
import { webArchiveHtml } from "../render/web-archive.js";
import type { ArtifactStore, Pointer } from "../store/artifacts.js";
import { openDb, type RowOf } from "../store/db.js";
import { MARKDOWN_OUTPUT } from "./render.js";
import type { Track } from "../telemetry.js";
import { endAttempt, tellEnding } from "./run.js";

export interface ShownRow {
  headline: string;
  tier: "must_know" | "should_know";
  source_id: string | null;
  source_title: string | null;
  cluster_id: string | null;
}

export function shownHeadlines(selections: Selections, index: Record<string, unknown>): ShownRow[] {
  const resolved = resolveArticleIds(selections, index);
  return (["must_know", "should_know"] as const).flatMap((tier) =>
    resolved[tier].flatMap((item) =>
      item.sources.map((src) => ({
        headline: item.headline ?? "",
        tier,
        source_id: src.source_id ?? null,
        source_title: src.original_title ?? null,
        cluster_id: item.cluster_id ?? null,
      })),
    ),
  );
}

export interface RecordDeps {
  store: ArtifactStore;
  dbUrl: string;
  track?: Track;
}

export function recordActivities(deps: RecordDeps) {
  const { store } = deps;
  const db = () => openDb(deps.dbUrl);
  const selectionsOf = async (p: Pointer) => JSON.parse(await store.get(p)) as Selections;
  return {
    archiveRun: (_runId: number, _selections: Pointer, _clusters: Pointer): Promise<void> => Promise.resolve(),

    saveDigest: async (runId: number, html: Pointer, selections: Pointer): Promise<{ date: string }> => {
      const date = await store.runDate(runId);
      const web = webArchiveHtml(await store.get(html));
      const preheader = (await selectionsOf(selections)).preheader ?? "";
      const mdPtr = await store.find(runId, MARKDOWN_OUTPUT);
      const markdown = mdPtr ? await store.get(mdPtr) : null;
      await db().tx(async (t) => {
        const latest = await t.one<Pick<RowOf<"issues">, "revision" | "run_id" | "html" | "preheader">>(
          "SELECT revision, run_id, html, preheader FROM issues WHERE issue_date=$1 ORDER BY revision DESC LIMIT 1",
          [date],
        );
        const keep = preheader === "" && latest ? latest.preheader : preheader;
        if (latest && latest.run_id === runId && latest.html === web && latest.preheader === keep) return;
        await t.run(
          "INSERT INTO issues (issue_date, revision, run_id, html, preheader, markdown) VALUES ($1, $2, $3, $4, $5, $6)",
          [date, (latest?.revision ?? 0) + 1, runId, web, keep, markdown],
        );
      }, `issue ${date}`);
      return { date };
    },

    recordShownHeadlines: async (runId: number, selections: Pointer): Promise<{ rows: number }> => {
      const indexPtr = await store.find(runId, "article_index.json");
      if (!indexPtr)
        throw ApplicationFailure.nonRetryable(
          `run ${runId} has no article_index.json to resolve its shown headlines`,
          "MissingInput",
        );
      const rows = shownHeadlines(
        await selectionsOf(selections),
        JSON.parse(await store.get(indexPtr)) as Record<string, unknown>,
      );
      await db().tx(async (t) => {
        await t.run("DELETE FROM story_sources WHERE run_id=$1", [runId]);
        for (const r of rows)
          await t.run(
            "INSERT INTO story_sources (headline, tier, source_id, source_title, cluster_id, run_id) VALUES ($1, $2, $3, $4, $5, $6)",
            [r.headline, r.tier, r.source_id, r.source_title, r.cluster_id, runId],
          );
      }, `shown ${runId}`);
      return { rows: rows.length };
    },

    abortRun: async (runId: number, error: string): Promise<void> => {
      const closed = await db().tx(async (t) => {
        await t.run("UPDATE runs SET status='failed', error=$1 WHERE id=$2 AND status='running'", [error, runId]);
        return endAttempt(t, runId, "failed", error);
      });
      if (closed) await tellEnding(deps.track, db(), runId, { outcome: "failed", error }, "digest_run_failed");
    },
  };
}

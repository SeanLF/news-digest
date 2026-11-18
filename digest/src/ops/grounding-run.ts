import type { GroundingReport } from "../gate/grounding.js";
import { groundFiles } from "../gate/grounding-inputs.js";
import { artifactIn } from "../store/artifacts.js";
import type { Sql } from "../store/db.js";

export async function groundRun(
  db: Sql,
  runId: number,
  names: ReadonlyMap<string, string>,
): Promise<GroundingReport | null> {
  const html = await artifactIn(db, runId, "digest.html");
  const selections = await artifactIn(db, runId, "selections.json");
  if (html === undefined || selections === undefined) return null;
  const csvs = await db.all<{ content: string }>(
    "SELECT content FROM artifacts WHERE run_id=$1 AND status='current' AND name ~ '^articles_[0-9]+\\.csv$' ORDER BY name",
    [runId],
  );
  return groundFiles(
    {
      html,
      selections,
      csvs: csvs.map((r) => r.content),
      fulltext: await artifactIn(db, runId, "article_fulltext.json"),
    },
    names,
  );
}

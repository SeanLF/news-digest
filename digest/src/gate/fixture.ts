import { createHash } from "node:crypto";
import { assertNoUrls, scrubUrls } from "../contracts/ids.js";
import { SelectionsSchema } from "../contracts/selections.js";

export type Files = Record<string, string>;

const JSON_INPUTS = ["selections.json", "draft_selections.json", "article_fulltext.json"] as const;
const CSV = /^articles_\d+\.csv$/;

const sha256 = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function runRow(artifacts: Files): { id?: number; started_at?: string; git_sha?: string } {
  const raw = artifacts["run.json"];
  if (!raw) return {};
  const doc = JSON.parse(raw) as { rows?: { id?: number; started_at?: string; git_sha?: string }[] };
  return doc.rows?.[0] ?? {};
}

export function fixtureFromRun(artifacts: Files): Files {
  const missing = ["digest.html", ...JSON_INPUTS].filter((n) => artifacts[n] === undefined);
  if (missing.length) throw new Error(`the run has no ${missing.join(", ")}: not a judge fixture`);
  const csvs = Object.keys(artifacts)
    .filter((n) => CSV.test(n))
    .toSorted((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (!csvs.length) throw new Error("the run has no articles_*.csv: not a judge fixture");
  SelectionsSchema.parse(JSON.parse(artifacts["selections.json"]!));

  const out: Files = { "digest.html": artifacts["digest.html"]! };
  for (const name of [...csvs, ...JSON_INPUTS]) {
    const text = scrubUrls(artifacts[name]!);
    assertNoUrls(text);
    if (name.endsWith(".json")) JSON.parse(text);
    out[`inputs/${name}`] = text;
  }
  const row = runRow(artifacts);
  const source = {
    run: row.id ?? null,
    date: row.started_at?.slice(0, 10) ?? null,
    git_sha: row.git_sha ?? null,
    artifacts: Object.fromEntries(
      ["digest.html", ...csvs, ...JSON_INPUTS].toSorted().map((n) => [n, sha256(artifacts[n]!)]),
    ),
  };
  out["source.json"] = `${JSON.stringify(source, null, 2)}\n`;
  return out;
}

import { createHash } from "node:crypto";
import { assertNoUrls, scrubUrls } from "../contracts/ids.js";
import { htmlEscape } from "escape-goat";
import { SelectionsSchema, type Selections } from "../contracts/selections.js";
import { mentions } from "./control.js";
import { plantDefects } from "./plant.js";

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

const SEED_TRIES = 200;
const jsonText = (s: string) => JSON.stringify(s).slice(1, -1);

function shownText(s: Selections): string {
  return [...s.must_know, ...s.should_know].flatMap((x) => [x.headline, x.summary, x.why_it_matters ?? ""]).join("\n");
}

export function plantedCopy(fixture: Files, seed: number, n: number): Files {
  const html = fixture["digest.html"];
  const sel = fixture["inputs/selections.json"];
  const draft = fixture["inputs/draft_selections.json"];
  if (html === undefined || sel === undefined || draft === undefined)
    throw new Error("a planted copy needs digest.html, inputs/selections.json and inputs/draft_selections.json");
  const selections = SelectionsSchema.parse(JSON.parse(sel));
  const text = shownText(selections);
  for (let s = seed; s < seed + SEED_TRIES; s++) {
    const { draft: planted, plants } = plantDefects(selections, s, n);
    if (!plants.every((p) => html.includes(htmlEscape(p.original)) && !mentions(text, p.marker))) continue;
    if (new Set(plants.map((p) => `${p.storyIndex}:${p.marker}`)).size < plants.length) continue;
    let page = html;
    let draftText = draft;
    const draftMisses: number[] = [];
    plants.forEach((p, i) => {
      page = page.replaceAll(htmlEscape(p.original), htmlEscape(p.planted));
      if (!draftText.includes(jsonText(p.original))) draftMisses.push(i);
      draftText = draftText.replaceAll(jsonText(p.original), jsonText(p.planted));
    });
    const others = Object.entries(fixture).filter(
      ([k]) => k.startsWith("inputs/") && k !== "inputs/selections.json" && k !== "inputs/draft_selections.json",
    );
    return {
      ...Object.fromEntries(others.map(([k, v]) => [`planted/${k}`, v])),
      "planted/digest.html": page,
      "planted/inputs/selections.json": `${JSON.stringify(planted, null, 2)}\n`,
      "planted/inputs/draft_selections.json": draftText,
      "planted/plants.json": `${JSON.stringify({ seed: s, plants, draft_misses: draftMisses }, null, 2)}\n`,
    };
  }
  throw new Error(`no seed in [${seed}, ${seed + SEED_TRIES}) plants ${n} defects into text the digest shows`);
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

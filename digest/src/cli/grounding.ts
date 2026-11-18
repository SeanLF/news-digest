import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { SelectionsSchema } from "../contracts/selections.js";
import { ground, plantsFlagged, type Article } from "../gate/grounding.js";
import { shownStories } from "../gate/shown.js";
import type { Plant } from "../gate/plant.js";

interface Row {
  article_id: string;
  source_id: string;
  title: string;
  published: string;
  summary: string;
}

function sourceNames(file: string | undefined): Map<string, string> {
  if (!file || !existsSync(file)) return new Map();
  const list = JSON.parse(readFileSync(file, "utf8")) as { id: string; name: string }[];
  return new Map(list.map((s) => [s.id, s.name]));
}

export function loadArticles(inputs: string, names: ReadonlyMap<string, string>): Map<string, Article> {
  const fulltextFile = join(inputs, "article_fulltext.json");
  const fulltext = existsSync(fulltextFile)
    ? (JSON.parse(readFileSync(fulltextFile, "utf8")) as Record<string, { text?: string }>)
    : {};
  const articles = new Map<string, Article>();
  for (const name of readdirSync(inputs).filter((n) => /^articles_\d+\.csv$/.test(n))) {
    const rows = parse<Row>(readFileSync(join(inputs, name), "utf8"), { columns: true, skip_empty_lines: true });
    for (const r of rows) {
      const text = fulltext[r.article_id]?.text;
      articles.set(r.article_id, {
        title: r.title,
        summary: r.summary,
        published: r.published,
        source: `${names.get(r.source_id) ?? ""} ${r.source_id.replaceAll("_", " ")}`,
        ...(text ? { fulltext: text } : {}),
      });
    }
  }
  return articles;
}

export function groundFixture(dir: string, sourcesFile?: string) {
  const inputs = join(dir, "inputs");
  const selections = SelectionsSchema.parse(JSON.parse(readFileSync(join(inputs, "selections.json"), "utf8")));
  const stories = shownStories(readFileSync(join(dir, "digest.html"), "utf8"), selections);
  const report = ground(stories, loadArticles(inputs, sourceNames(sourcesFile)));
  const plantsFile = join(dir, "plants.json");
  if (!existsSync(plantsFile)) return report;
  const { plants } = JSON.parse(readFileSync(plantsFile, "utf8")) as { plants: Plant[] };
  const recall = plantsFlagged(plants, report.unsupported);
  return {
    ...report,
    plants: {
      caught: recall.caught,
      total: recall.total,
      missed: recall.missed.map((p) => `${p.storyIndex}:${p.field}:${p.marker}`),
    },
  };
}

if (process.argv[1]?.endsWith("grounding.js")) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: grounding <fixture-dir> (e.g. evals/fixtures/gate/day-349 or its planted/)");
    process.exit(2);
  }
  console.log(JSON.stringify(groundFixture(dir, process.env["SOURCES_FILE"] ?? "/app/sources.json"), null, 2));
}

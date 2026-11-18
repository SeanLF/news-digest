import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { groundFiles, sourceNamesFrom } from "../gate/grounding-inputs.js";
import { plantsFlagged } from "../gate/grounding.js";
import type { Plant } from "../gate/plant.js";

export function groundFixture(dir: string, sourcesFile?: string) {
  const inputs = join(dir, "inputs");
  const read = (name: string) => readFileSync(join(inputs, name), "utf8");
  const fulltext = join(inputs, "article_fulltext.json");
  const report = groundFiles(
    {
      html: readFileSync(join(dir, "digest.html"), "utf8"),
      selections: read("selections.json"),
      csvs: readdirSync(inputs)
        .filter((n) => /^articles_\d+\.csv$/.test(n))
        .map(read),
      fulltext: existsSync(fulltext) ? readFileSync(fulltext, "utf8") : undefined,
    },
    sourcesFile && existsSync(sourcesFile) ? sourceNamesFrom(readFileSync(sourcesFile, "utf8")) : new Map(),
  );
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

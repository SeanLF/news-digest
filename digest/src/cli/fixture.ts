import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixtureFromRun, plantedCopy, type Files } from "../gate/fixture.js";

export const PLANTS = 3;
export const PLANT_SEED = 1;

function readDir(dir: string): Files {
  const files: Files = {};
  for (const name of readdirSync(dir))
    if (statSync(join(dir, name)).isFile()) files[name] = readFileSync(join(dir, name), "utf8");
  return files;
}

function writeFiles(root: string, files: Files): void {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

export function plantFixture(dir: string, seed = PLANT_SEED, n = PLANTS): void {
  const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
  const planted = plantedCopy(
    {
      "digest.html": read("digest.html"),
      "inputs/selections.json": read("inputs/selections.json"),
      "inputs/draft_selections.json": read("inputs/draft_selections.json"),
    },
    seed,
    n,
  );
  writeFiles(dir, planted);
  for (const name of readdirSync(join(dir, "inputs"))) {
    const link = join(dir, "planted", "inputs", name);
    if (planted[`planted/inputs/${name}`] !== undefined) continue;
    rmSync(link, { force: true });
    symlinkSync(join("..", "..", "inputs", name), link);
  }
}

export function exportFixture(rawDir: string, outDir: string): void {
  writeFiles(outDir, fixtureFromRun(readDir(rawDir)));
  plantFixture(outDir);
}

if (process.argv[1]?.endsWith("fixture.js")) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "export" && a && b) {
    exportFixture(a, b);
    console.log(`fixture: ${b} from ${a}, with its planted copy`);
  } else if (cmd === "plant" && a) {
    plantFixture(a, b ? Number(b) : PLANT_SEED);
    console.log(`fixture: ${a}/planted`);
  } else {
    console.error("usage: fixture export <run-artifacts-dir> <fixture-dir> | fixture plant <fixture-dir> [seed]");
    process.exit(2);
  }
}

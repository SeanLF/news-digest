import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fixtureFromRun, type Files } from "../gate/fixture.js";

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

export function exportFixture(rawDir: string, outDir: string): void {
  writeFiles(outDir, fixtureFromRun(readDir(rawDir)));
}

if (process.argv[1]?.endsWith("fixture.js")) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "export" && a && b) {
    exportFixture(a, b);
    console.log(`fixture: ${b} from ${a}`);
  } else {
    console.error("usage: fixture export <run-artifacts-dir> <fixture-dir>");
    process.exit(2);
  }
}

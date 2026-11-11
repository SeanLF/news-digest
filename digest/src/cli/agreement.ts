import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judgeReport } from "../gate/judge-report.js";
import type { Plant } from "../gate/plant.js";

const [fixture, clean, planted, out] = process.argv.slice(2);
if (!fixture || !clean || !planted)
  throw new Error("usage: agreement <fixture-dir> <clean results.json> <planted results.json> [report.json]");
const read = (f: string): unknown => JSON.parse(readFileSync(f, "utf8"));
const { plants } = read(join(fixture, "planted", "plants.json")) as { plants: Plant[] };
const report = judgeReport(read(clean), read(planted), plants);
const text = JSON.stringify(report, null, 2);
if (out) writeFileSync(out, `${text}\n`);
console.log(text);
if (report.verdict !== "pass") {
  console.error("judges: the negative control failed, so no score from this run counts");
  process.exit(1);
}

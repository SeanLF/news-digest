// Replays one model stage of a stored run (gate/stage-replay.ts) and writes the result; bin/replay runs it.
// Usage: node dist/cli/stage-replay.js MODE OUT.json, with RUN, AGENTS_DIR and DIGEST_DATABASE_URL set.
import { writeFileSync } from "node:fs";
import { MODES, replay, type Mode } from "../gate/stage-replay.js";
import { ArtifactStore } from "../store/artifacts.js";

const [mode, outPath] = process.argv.slice(2);
if (!MODES.includes(mode as Mode) || !outPath) throw new Error(`usage: stage-replay.js ${MODES.join("|")} OUT.json`);
const run = Number(process.env["RUN"]);
const agentsDir = process.env["AGENTS_DIR"];
const db = process.env["DIGEST_DATABASE_URL"];
if (!Number.isInteger(run) || !agentsDir || !db) throw new Error("RUN, AGENTS_DIR and DIGEST_DATABASE_URL are required");
const { artifact, usage, failure } = await replay(mode as Mode, new ArtifactStore(db), run, agentsDir);
// A failed replay is a result too (a variant's failure rate is what a comparison counts): written, exit 0.
writeFileSync(outPath, JSON.stringify({ mode, run, agentsDir, ...usage, failure, artifact }));
const lost = usage.lostBatches.length ? `, ${usage.lostBatches.length} batch(es) lost` : "";
const failed = failure ? `, FAILED: ${failure.error.slice(0, 160)} (in a run: ${failure.prodOnFailure})` : "";
console.log(`${mode} run ${run}: ${usage.calls} calls, $${usage.costUsd.toFixed(4)}, ${usage.models.join(",")} ${usage.efforts.join(",")}${lost}${failed}`);
process.exit(0);

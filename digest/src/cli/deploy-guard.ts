import { connect } from "../client.js";
import { guard } from "../deploy-guard.js";

const force = process.argv.includes("--force");
const problems = await guard(await connect());
for (const p of problems) console.log(`${force ? "deploying anyway (--force)" : "refused"}: ${p}`);
if (problems.length === 0) console.log("deploy-guard: no run in flight, outside the run window");
process.exitCode = problems.length && !force ? 1 : 0;

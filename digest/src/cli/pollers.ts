import { connect } from "../client.js";
import { missingPollers } from "../pollers.js";
import { PYTHON_TASK_QUEUE } from "../workflow/policy.js";

const queues = process.argv.length > 2 ? process.argv.slice(2) : [PYTHON_TASK_QUEUE];
const missing = await missingPollers(await connect(), queues);
for (const m of missing) console.log(`missing: ${m}`);
if (missing.length === 0) console.log(`pollers: ${queues.join(", ")} polled`);
process.exitCode = missing.length ? 1 : 0;

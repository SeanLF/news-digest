import { writeFileSync } from "node:fs";
import { NativeConnection, Runtime, Worker } from "@temporalio/worker";
import { workerActivities } from "./activities/real.js";
import { deploymentOptions } from "./deployment.js";
import { log } from "./log.js";
import { operationsEnvWarning } from "./ops/env.js";
import { temporalLogger } from "./temporal-logger.js";
import { dbUrl } from "./store/db.js";
export const TASK_QUEUE = "digest";
export const temporalNamespace = (env: Record<string, string | undefined> = process.env): string =>
  env["TEMPORAL_NAMESPACE"] ?? "default";
export const ALIVE_FILE = "/tmp/worker-alive";
export function touchWhileRunning(worker: Pick<Worker, "getState">, path = ALIVE_FILE, everyMs = 5_000): () => void {
  const timer = setInterval(() => {
    if (worker.getState() !== "RUNNING") return;
    try {
      writeFileSync(path, "");
    } catch {}
  }, everyMs);
  return () => clearInterval(timer);
}
export async function runWorker(address = process.env["TEMPORAL_ADDRESS"] ?? "localhost:7233"): Promise<void> {
  const warning = operationsEnvWarning(process.env);
  if (warning) log.warn(`WARN ${warning}`);
  dbUrl();
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: temporalNamespace(),
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("./workflow/digest.workflow.js", import.meta.url).pathname,
    activities: workerActivities(),
    workerDeploymentOptions: deploymentOptions(),
  });
  const stopTouching = touchWhileRunning(worker);
  try {
    await worker.run();
  } finally {
    stopTouching();
  }
}
if (process.argv[1]?.endsWith("worker.js")) {
  Runtime.install({ logger: temporalLogger(log) });
  await runWorker();
}

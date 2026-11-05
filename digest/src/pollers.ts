import type { Client } from "@temporalio/client";
import { ACTIVITY_QUEUE } from "./deployment.js";

export async function missingPollers(client: Client, queues: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const name of queues) {
    try {
      const { pollers } = await client.workflowService.describeTaskQueue({
        namespace: client.options.namespace,
        taskQueue: { name },
        taskQueueType: ACTIVITY_QUEUE,
      });
      if (!pollers?.length) missing.push(`no worker polls the ${name} task queue`);
    } catch (e) {
      missing.push(`could not describe the ${name} task queue: ${String(e)}`);
    }
  }
  return missing;
}

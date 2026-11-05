import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Activities, ThreadsReport } from "../activities/index.js";
import { stubActivities } from "../activities/stub.js";
import { ThreadsPhaseProbe } from "./threads.test-workflow.js";

let env: TestWorkflowEnvironment;
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 180_000);
afterAll(async () => {
  await env?.teardown();
});

const slow = () =>
  new Promise<never>((_resolve, reject) => {
    const t = setTimeout(() => reject(new Error("too slow")), 10_000);
    Context.current().cancelled.catch((e: unknown) => {
      clearTimeout(t);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });

it("a phase that outruns its bound is cut off and recorded, and the render gets no context", async () => {
  const reports: ThreadsReport[] = [];
  const activities: Activities = {
    ...stubActivities(),
    threadSynthesis: slow,
    threadsFinish: (runId, report) => {
      reports.push(report);
      return Promise.resolve({ runId, name: "thread_context.json", sha256: "0".repeat(64) });
    },
  };
  const taskQueue = "threads-phase-test";
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: new URL("./threads.test-workflow.ts", import.meta.url).pathname,
    activities,
  });
  const started = Date.now();
  await worker.runUntil(
    env.client.workflow.execute(ThreadsPhaseProbe, { taskQueue, workflowId: "threads-bound", args: [1, "2 seconds"] }),
  );
  expect(Date.now() - started).toBeLessThan(9_000);
  expect(reports).toEqual([{ outcomes: [], failures: [], timedOut: true }]);
}, 120_000);

import type { WorkflowHandle } from "@temporalio/client";
import { temporal } from "@temporalio/proto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stubActivities } from "./activities/stub.js";
import { scheduleOptions, startOptions } from "./client.js";
import { DEPLOYMENT_NAME, deploymentOptions, setCurrentVersion, strandedRuns, waitingRuns } from "./deployment.js";
import { missingPollers } from "./pollers.js";
import { TASK_QUEUE } from "./worker.js";
import { approveSignal } from "./workflow/signals.js";
import { PYTHON_TASK_QUEUE } from "./workflow/policy.js";

const PINNED = temporal.api.enums.v1.VersioningBehavior.VERSIONING_BEHAVIOR_PINNED;
const PIN = temporal.api.workflow.v1.VersioningOverride.PinnedOverrideBehavior.PINNED_OVERRIDE_BEHAVIOR_PINNED;

let env: TestWorkflowEnvironment;
let python: { shutdown: () => void; done: Promise<void> } | undefined;
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal({
    server: { executable: { type: "cached-download", version: "v1.9.1" } },
  });
  const w = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: PYTHON_TASK_QUEUE,
    activities: {
      fetchFulltext: (tasks: unknown[]) => Promise.resolve({ tasks: tasks.length, results: {}, outcome: "completed" }),
    },
  });
  python = { shutdown: () => w.shutdown(), done: w.run() };
}, 300_000);
afterAll(async () => {
  python?.shutdown();
  await python?.done;
  await env?.teardown();
});

const workflowsPath = new URL("./workflow/digest.workflow.ts", import.meta.url).pathname;
const held = () => ({ ...stubActivities(), checkPreSend: () => Promise.resolve(["TEST: held for the operator"]) });
const versioned = (buildId: string) =>
  Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    maxCachedWorkflows: 0,
    workerDeploymentOptions: deploymentOptions({ GIT_SHA: buildId }),
    activities: held(),
  });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const completedTasks = async (h: WorkflowHandle) =>
  ((await h.fetchHistory()).events ?? []).flatMap((e) =>
    e.workflowTaskCompletedEventAttributes ? [e.workflowTaskCompletedEventAttributes] : [],
  );
async function versionOf(h: WorkflowHandle) {
  const v = (await h.describe()).raw.workflowExecutionInfo?.versioningInfo;
  return { behavior: v?.behavior, buildId: v?.deploymentVersion?.buildId };
}
async function moveToVersion(workflowId: string, buildId: string): Promise<void> {
  await env.client.workflowService.updateWorkflowExecutionOptions({
    namespace: env.client.options.namespace,
    workflowExecution: { workflowId },
    workflowExecutionOptions: {
      versioningOverride: { pinned: { behavior: PIN, version: { deploymentName: DEPLOYMENT_NAME, buildId } } },
    },
    updateMask: { paths: ["versioning_override"] },
  });
}
async function untilInHold(h: WorkflowHandle): Promise<void> {
  for (let i = 0; i < 600; i++) {
    const evs = (await h.fetchHistory()).events ?? [];
    const notified = evs.findIndex((e) => e.activityTaskScheduledEventAttributes?.activityType?.name === "notifyHold");
    if (notified >= 0 && evs.slice(notified).some((e) => e.timerStartedEventAttributes)) return;
    await pause(100);
  }
  throw new Error("the run never reached the hold");
}

async function settled(queue: string): Promise<string[]> {
  for (let i = 0; i < 50 && (await missingPollers(env.client, [queue])).length; i++) await pause(100);
  return missingPollers(env.client, [queue]);
}
describe("missingPollers on a dev server", () => {
  it("sees the unversioned Python worker, which polls activities only, and a versioned digest worker; not a queue nobody polls", async () => {
    expect(await settled(PYTHON_TASK_QUEUE)).toEqual([]);
    expect(await settled("nobody-polls")).toEqual(["no worker polls the nobody-polls task queue"]);
    await (await versioned("build-p")).runUntil(async () => expect(await settled(TASK_QUEUE)).toEqual([]));
  }, 60_000);
});

describe("worker versioning on a dev server", () => {
  it("a run started before any version is current waits; setting the version current starts it, pinned, and it records the version in its history", async () => {
    const a = await versioned("build-a");
    await a.runUntil(async () => {
      const h = await env.client.workflow.start("DigestWorkflow", startOptions("2026-10-01", {}));
      await pause(3000);
      expect(await completedTasks(h)).toEqual([]);
      await setCurrentVersion(env.client, "build-a", TASK_QUEUE);
      expect(await strandedRuns(env.client, "build-a")).toEqual([]);
      await h.signal(approveSignal, { decision: "approve" });
      expect((await h.result()).broadcast).toBe("sent");
      const first = (await completedTasks(h))[0];
      expect(first?.versioningBehavior).toBe(PINNED);
      expect(first?.deploymentVersion).toMatchObject({ deploymentName: DEPLOYMENT_NAME, buildId: "build-a" });
      expect(await versionOf(h)).toEqual({ behavior: PINNED, buildId: "build-a" });
      const evs = (await h.fetchHistory()).events ?? [];
      const scheduled = evs
        .filter((e) => e.activityTaskScheduledEventAttributes?.activityType?.name === "fetchFulltext")
        .map((e) => String(e.eventId));
      const completed = evs.filter((e) =>
        scheduled.includes(String(e.activityTaskCompletedEventAttributes?.scheduledEventId)),
      );
      expect(scheduled.length).toBe(1);
      expect(completed.length).toBe(1);
    });
  }, 120_000);

  it("a scheduled start (and the bootstrap's trigger of it) lands on the current version", async () => {
    const a = await versioned("build-a");
    await a.runUntil(async () => {
      await setCurrentVersion(env.client, "build-a", TASK_QUEUE);
      const schedule = await env.client.schedule.create({
        ...scheduleOptions(),
        scheduleId: "digest-daily-versioning-test",
      });
      await schedule.trigger();
      let started: string | undefined;
      for (let i = 0; i < 100 && !started; i++) {
        started = (await schedule.describe()).info.recentActions[0]?.action.workflow.workflowId;
        if (!started) await pause(100);
      }
      const h = env.client.workflow.getHandle(started ?? "none");
      for (let i = 0; i < 100 && (await completedTasks(h)).length === 0; i++) await pause(100);
      expect(await versionOf(h)).toEqual({ behavior: PINNED, buildId: "build-a" });
      await h.terminate("checked");
      await schedule.delete();
    });
  }, 120_000);

  it("a build is made current once the server has registered it on both queue types, not when its first poller shows", async () => {
    const opts = (buildId: string) => ({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      maxCachedWorkflows: 0,
      workerDeploymentOptions: deploymentOptions({ GIT_SHA: buildId }),
    });
    const p = await versioned("build-p");
    await p.runUntil(() => setCurrentVersion(env.client, "build-p", TASK_QUEUE));
    const pWorkflows = await Worker.create({ ...opts("build-p"), workflowsPath });
    const pDone = pWorkflows.run();
    const h = await env.client.workflow.start("DigestWorkflow", startOptions("2026-10-06", {}));
    const qWorkflows = await Worker.create({ ...opts("build-q"), workflowsPath });
    const qActivities = await Worker.create({ ...opts("build-q"), activities: held() });
    const qDone = qWorkflows.run();
    let actDone: Promise<void> | undefined;
    try {
      for (let i = 0; i < 100 && (await completedTasks(h)).length === 0; i++) await pause(100);
      const setting = setCurrentVersion(env.client, "build-q", TASK_QUEUE, 30_000);
      setting.catch(() => undefined);
      await pause(4000);
      actDone = qActivities.run();
      await setting;
      const { routingConfig } =
        (
          await env.client.workflowService.describeWorkerDeployment({
            namespace: env.client.options.namespace,
            deploymentName: DEPLOYMENT_NAME,
          })
        ).workerDeploymentInfo ?? {};
      expect(routingConfig?.currentDeploymentVersion?.buildId).toBe("build-q");
    } finally {
      await h.terminate("checked").catch(() => undefined);
      for (const w of [pWorkflows, qWorkflows, qActivities]) if (w.getState() === "RUNNING") w.shutdown();
      await Promise.all([pDone, qDone, actDone]);
    }
  }, 120_000);

  it("a run waiting, unpinned, while current names a build with no worker, is named as waiting", async () => {
    const f = await versioned("build-h");
    await f.runUntil(async () => {
      await setCurrentVersion(env.client, "build-h", TASK_QUEUE);
      await env.client.workflowService.setWorkerDeploymentCurrentVersion({
        namespace: env.client.options.namespace,
        deploymentName: DEPLOYMENT_NAME,
        buildId: "build-i",
        allowNoPollers: true,
        ignoreMissingTaskQueues: true,
      });
      const h = await env.client.workflow.start("DigestWorkflow", startOptions("2026-10-05", {}));
      try {
        await pause(3000);
        expect(await completedTasks(h)).toEqual([]);
        await expect(setCurrentVersion(env.client, "build-i", TASK_QUEUE, 3000)).rejects.toThrow(
          /no worker of digest:build-i/,
        );
        expect(await strandedRuns(env.client, "build-i")).toEqual([]);
        expect(await waitingRuns(env.client)).toEqual([h.workflowId]);
        await setCurrentVersion(env.client, "build-h", TASK_QUEUE);
        await untilInHold(h);
        expect(await waitingRuns(env.client)).toEqual([]);
      } finally {
        await h.terminate("checked").catch(() => undefined);
      }
    });
  }, 120_000);

  it("a run pinned to a build whose worker is gone is named as stranded, sits still, and runs on once moved", async () => {
    const a = await versioned("build-b");
    const drained = a.run();
    await setCurrentVersion(env.client, "build-b", TASK_QUEUE);
    const h = await env.client.workflow.start("DigestWorkflow", startOptions("2026-10-02", {}));
    await untilInHold(h);
    a.shutdown();
    await drained;
    const c = await versioned("build-c");
    await c.runUntil(async () => {
      await setCurrentVersion(env.client, "build-c", TASK_QUEUE);
      expect(await strandedRuns(env.client, "build-c")).toEqual([{ workflowId: h.workflowId, buildId: "build-b" }]);
      const before = (await completedTasks(h)).length;
      await h.signal(approveSignal, { decision: "approve" });
      await pause(3000);
      expect((await completedTasks(h)).length).toBe(before);
      expect((await h.describe()).status.name).toBe("RUNNING");
      await moveToVersion(h.workflowId, "build-c");
      expect((await h.result()).broadcast).toBe("sent");
      expect((await completedTasks(h)).at(-1)?.deploymentVersion?.buildId).toBe("build-c");
      expect(await strandedRuns(env.client, "build-c")).toEqual([]);
    });
  }, 180_000);
});

import type { Client } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";
import { DEPLOYMENT_NAME, deploymentOptions, setCurrentVersion, waitingLine } from "./deployment.js";
import { TASK_QUEUE } from "./worker.js";

describe("deploymentOptions", () => {
  it("pins every workflow to the build that started it; the build id is the image's GIT_SHA", () => {
    expect(deploymentOptions({ GIT_SHA: "934ce99" })).toEqual({
      version: { deploymentName: DEPLOYMENT_NAME, buildId: "934ce99" },
      useWorkerVersioning: true,
      defaultVersioningBehavior: "PINNED",
    });
  });
  it.each([undefined, "", "  "])(
    "refuses a worker with no build id (GIT_SHA %j): it would share a version with every other such build",
    (sha) => {
      expect(() => deploymentOptions(sha === undefined ? {} : { GIT_SHA: sha })).toThrow(/GIT_SHA/);
    },
  );
});

describe("waitingLine", () => {
  it("is the line set-current prints for a run no worker has taken", () => {
    expect(waitingLine(["digest-2026-10-05"])).toBe(
      "waiting: digest-2026-10-05 -- no worker has taken these; they start once a polling build is current",
    );
  });
});

describe("setCurrentVersion", () => {
  it("does not set a build that polls but is not yet registered in the deployment (NOT_FOUND)", async () => {
    let describes = 0;
    const registered = () => describes > 2;
    const notFound = Object.assign(
      new Error("5 NOT_FOUND: build ID 'build-z' not found in Worker Deployment 'digest'"),
      { code: 5, details: "", metadata: {} },
    );
    const sets: string[] = [];
    const workflowService = {
      describeTaskQueue: () =>
        Promise.resolve({ pollers: [{ deploymentOptions: { deploymentName: DEPLOYMENT_NAME, buildId: "build-z" } }] }),
      describeWorkerDeploymentVersion: () => {
        describes++;
        return registered()
          ? Promise.resolve({
              versionTaskQueues: [
                { name: TASK_QUEUE, type: 1 },
                { name: TASK_QUEUE, type: 2 },
              ],
            })
          : Promise.reject(notFound);
      },
      setWorkerDeploymentCurrentVersion: ({ buildId }: { buildId: string }) => {
        if (!registered()) return Promise.reject(notFound);
        sets.push(buildId);
        return Promise.resolve({});
      },
    };
    const client = { options: { namespace: "default", identity: "test" }, workflowService } as unknown as Client;
    vi.useFakeTimers();
    try {
      const set = setCurrentVersion(client, "build-z", TASK_QUEUE, 30_000);
      await vi.runAllTimersAsync();
      await set;
    } finally {
      vi.useRealTimers();
    }
    expect(sets).toEqual(["build-z"]);
  });
});

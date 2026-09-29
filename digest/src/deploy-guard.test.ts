import type { Client } from "@temporalio/client";
import { describe, expect, it } from "vitest";
import { guard, inRunWindow, runningDigests } from "./deploy-guard.js";

describe("inRunWindow", () => {
  it.each([
    ["2026-07-15T09:59:00Z", false],
    ["2026-07-15T10:00:00Z", true],
    ["2026-07-15T11:44:00Z", true],
    ["2026-07-15T11:45:00Z", false],
    ["2026-01-15T10:00:00Z", true], // the same hours in winter
    ["2026-01-15T11:50:00Z", false],
  ])("%s -> %s: 10:00 to 11:45 UTC, all year", (iso, want) => {
    expect(inRunWindow(new Date(iso))).toBe(want);
  });
});

const listing = (runs: { workflowId: string; stuck?: boolean }[], seen: string[] = []) =>
  ({
    workflow: {
      list: ({ query }: { query: string }) => {
        seen.push(query);
        return (async function* () {
          for (const r of runs) yield { workflowId: r.workflowId, raw: { searchAttributes: { indexedFields: r.stuck ? { TemporalReportedProblems: {} } : {} } } };
        })();
      },
    },
  }) as unknown as Client;

describe("runningDigests", () => {
  it("asks for running DigestWorkflows and names a run whose workflow task keeps failing", async () => {
    const seen: string[] = [];
    expect(await runningDigests(listing([{ workflowId: "digest-2026-09-25" }, { workflowId: "digest-2026-09-24", stuck: true }], seen))).toEqual([
      "digest-2026-09-25",
      "digest-2026-09-24 (stuck: its workflow task keeps failing)",
    ]);
    expect(seen).toEqual(['WorkflowType="DigestWorkflow" AND ExecutionStatus="Running"']);
  });
});

describe("guard", () => {
  const quiet = new Date("2026-07-15T15:00:00Z");
  it("passes outside the window with nothing running", async () => {
    expect(await guard(listing([]), quiet)).toEqual([]);
  });
  it("refuses inside the window and while a digest runs, naming both", async () => {
    expect(await guard(listing([{ workflowId: "digest-2026-07-15" }]), new Date("2026-07-15T10:30:00Z"))).toEqual([
      "10:30 UTC is inside the run window (10:00-11:45 UTC)",
      "digest workflow(s) running: digest-2026-07-15",
    ]);
  });
  it("refuses when the running digests cannot be listed, rather than guessing", async () => {
    const broken = { workflow: { list: () => { throw new Error("14 UNAVAILABLE"); } } } as unknown as Client;
    expect(await guard(broken, quiet)).toEqual(["could not list the running digest workflows: Error: 14 UNAVAILABLE"]);
  });
});

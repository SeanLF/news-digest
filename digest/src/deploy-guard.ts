import type { Client } from "@temporalio/client";

const WINDOW = { from: 1000, to: 1145 };

const utcHhmm = (now: Date): number => now.getUTCHours() * 100 + now.getUTCMinutes();

export const inRunWindow = (now: Date): boolean => {
  const t = utcHhmm(now);
  return t >= WINDOW.from && t < WINDOW.to;
};

export const RUNNING_DIGESTS_QUERY = 'WorkflowType="DigestWorkflow" AND ExecutionStatus="Running"';

export async function runningDigests(client: Client): Promise<string[]> {
  const ids: string[] = [];
  for await (const w of client.workflow.list({ query: RUNNING_DIGESTS_QUERY })) {
    const stuck = "TemporalReportedProblems" in (w.raw.searchAttributes?.indexedFields ?? {});
    ids.push(w.workflowId + (stuck ? " (stuck: its workflow task keeps failing)" : ""));
  }
  return ids;
}

export async function guard(client: Client, now = new Date()): Promise<string[]> {
  const problems: string[] = [];
  if (inRunWindow(now)) {
    const t = String(utcHhmm(now)).padStart(4, "0");
    problems.push(`${t.slice(0, 2)}:${t.slice(2)} UTC is inside the run window (10:00-11:45 UTC)`);
  }
  try {
    const running = await runningDigests(client);
    if (running.length) problems.push(`digest workflow(s) running: ${running.join(", ")}`);
  } catch (e) {
    problems.push(`could not list the running digest workflows: ${String(e)}`);
  }
  return problems;
}

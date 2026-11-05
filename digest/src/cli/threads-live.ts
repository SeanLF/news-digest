import { THREAD_ASSIGNMENTS, THREAD_LINKS, threadsActivities, threadsConfigFrom } from "../activities/threads.js";
import { DEFAULT_AGENTS_DIR } from "../activities/real.js";
import { ArtifactStore } from "../store/artifacts.js";
import { dbUrl, openDb } from "../store/db.js";
import { recordUsage, runCost } from "../store/usage.js";

const run = Number(process.argv[2]);
if (!Number.isInteger(run)) throw new Error("usage: threads-live RUN");
const store = new ArtifactStore(dbUrl());
const db = openDb(dbUrl());
const since = (await db.one<{ t: string }>("SELECT now() AS t"))!.t;
const acts = threadsActivities({
  store,
  dbUrl: dbUrl(),
  agentsDir: process.env["AGENTS_DIR"] ?? DEFAULT_AGENTS_DIR,
  config: threadsConfigFrom(process.env),
  maxAttempts: 1,
  onUsage: (row) => recordUsage(db, row),
});

const { plans } = await acts.threadsLink(run);
const outcomes = [];
const failures = [];
for (const p of process.argv.includes("--link-only") ? [] : plans) {
  try {
    outcomes.push(await acts.threadSynthesis(run, p));
  } catch (e) {
    failures.push({ threadId: p.threadId, error: String(e) });
  }
}
await acts.threadsFinish(run, { outcomes, failures });
const links = JSON.parse(await store.content(run, THREAD_LINKS)) as {
  linker_ok: boolean;
  stories: { label: string; proposed_thread: number | null; outcome: string }[];
};
console.log(
  JSON.stringify(
    {
      run,
      linkerOk: links.linker_ok,
      stories: links.stories.map((s) => [s.label, s.outcome, s.proposed_thread]),
      assignments: JSON.parse(await store.content(run, THREAD_ASSIGNMENTS)) as unknown,
      synthesized: outcomes.length,
      auditFailures: outcomes.filter((o) => o.auditFailed).length,
      failures,
      cost: await runCost(db, run, since),
    },
    null,
    2,
  ),
);
process.exit(0);

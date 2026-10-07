// A promptfoo provider that replays one model stage of a stored run (vars.run) with a variant
// (config.overrides on the stage prompts' frontmatter), each call on its own scratch copy of the
// template database (default digest_clone, from make db-clone), and scores nothing itself: the output
// carries the replay and the run's own artifact as the reference, for replay-assert.ts.
// Runs in the worker image (make replay); REPLAY_ADMIN_URL is a superuser URL on that Postgres.
// promptfoo's -j runs calls in parallel and --repeat makes the reps; model calls in flight are bounded
// across all of them here (REPLAY_CALLS, default 4: what the subscription is known to tolerate).
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import pg from "pg";
import { ArtifactStore } from "../store/artifacts.js";
import { MODEL_FANOUT_LIMIT } from "../workflow/bounded.js";
import { agentsWith, type Overrides } from "./agent-overrides.js";
import { MODES, replay, type Mode } from "./stage-replay.js";

interface Config { mode: Mode; overrides?: Overrides; template?: string; agentsDir?: string }
export const OUTPUT: Record<Mode, string> = { cluster: "clusters.json", select: "selected.json", coherence: "coherence_report.json", attribute: "attribution.json" };

// Model calls a replay of each mode can have in flight: cluster and attribute fan out
// MODEL_FANOUT_LIMIT calls inside the stage (cluster's batches, attribute's per-story workers).
export const WEIGHT: Record<Mode, number> = { cluster: MODEL_FANOUT_LIMIT, attribute: MODEL_FANOUT_LIMIT, select: 1, coherence: 1 };

export function callBudget(raw: string | undefined): number {
  const n = raw === undefined ? 4 : Number(raw);
  if (!Number.isInteger(n) || n < 1 || raw === "") throw new Error(`REPLAY_CALLS must be a positive whole number, not ${JSON.stringify(raw)}`);
  return n;
}

// Takes a call's slots all at once (two wide calls cannot deadlock), first come first served (narrow
// calls queued behind a wide one wait for it, so it is never starved).
export class Slots {
  private free: number;
  private readonly queue: { k: number; go: () => void }[] = [];
  constructor(n: number) {
    this.free = n;
  }
  take(k: number): Promise<void> {
    return new Promise((go) => {
      this.queue.push({ k, go });
      this.drain();
    });
  }
  give(k: number): void {
    this.free += k;
    this.drain();
  }
  private drain(): void {
    while (this.queue.length && this.queue[0]!.k <= this.free) {
      const { k, go } = this.queue.shift()!;
      this.free -= k;
      go();
    }
  }
}
const budget = callBudget(process.env["REPLAY_CALLS"]);
const slots = new Slots(budget);

async function admin(url: string, sql: string): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

export default class ReplayProvider {
  private readonly config: Required<Pick<Config, "mode" | "template" | "agentsDir">> & { overrides: Overrides };
  constructor(options: { config?: Partial<Config> } = {}) {
    const c = options.config ?? {};
    if (!c.mode || !MODES.includes(c.mode)) throw new Error(`replay provider needs config.mode, one of ${MODES.join(", ")}`);
    if (WEIGHT[c.mode] > budget) throw new Error(`a ${c.mode} replay holds ${WEIGHT[c.mode]} call slots; REPLAY_CALLS is ${budget}`);
    this.config = { mode: c.mode, overrides: c.overrides ?? {}, template: c.template ?? "digest_clone", agentsDir: c.agentsDir ?? new URL("../../agents/", import.meta.url).pathname };
  }
  id(): string {
    const o = Object.entries(this.config.overrides).flatMap(([s, f]) => Object.entries(f).map(([k, v]) => `${s}.${k}=${v}`));
    return `replay:${this.config.mode}${o.length ? `:${o.join(",")}` : ""}`;
  }
  async callApi(_prompt: string, context: { vars: { run: number | string } }) {
    const adminUrl = process.env["REPLAY_ADMIN_URL"];
    if (!adminUrl) throw new Error("REPLAY_ADMIN_URL is unset (a superuser URL on the Postgres holding the template)");
    const { mode, overrides, template } = this.config;
    const run = Number(context.vars.run);
    const db = `replay_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const url = Object.assign(new URL(adminUrl), { pathname: `/${db}` }).toString();
    const weight = WEIGHT[mode];
    const agents = agentsWith(this.config.agentsDir, overrides);
    await slots.take(weight);
    try {
      await admin(adminUrl, `CREATE DATABASE ${db} TEMPLATE ${template}`);
      const store = new ArtifactStore(url);
      const refPtr = await store.find(run, OUTPUT[mode]);
      if (!refPtr) throw new Error(`run ${run} has no ${OUTPUT[mode]} to compare against`);
      const reference: unknown = JSON.parse(await store.get(refPtr));
      const t0 = Date.now();
      const r = await replay(mode, store, run, agents);
      return { output: JSON.stringify({ mode, run, artifact: r.artifact, failure: r.failure, reference }), cost: r.usage.costUsd, latencyMs: Date.now() - t0, metadata: { usage: r.usage } };
    } finally {
      slots.give(weight);
      rmSync(agents, { recursive: true, force: true });
      await admin(adminUrl, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
    }
  }
}

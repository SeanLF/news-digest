import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import pg from "pg";
import { ArtifactStore } from "../store/artifacts.js";
import { agentsWith, overrideLabel, type Overrides } from "./agent-overrides.js";
import { MODES, replay, type Mode } from "./stage-replay.js";

interface Config {
  mode: Mode;
  overrides?: Overrides;
  template?: string;
  agentsDir?: string;
}
export const OUTPUT: Record<Mode, string> = {
  cluster: "clusters.json",
  select: "selected.json",
  coherence: "coherence_report.json",
  attribute: "attribution.json",
};

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
    if (!c.mode || !MODES.includes(c.mode))
      throw new Error(`replay provider needs config.mode, one of ${MODES.join(", ")}`);
    this.config = {
      mode: c.mode,
      overrides: c.overrides ?? {},
      template: c.template ?? "digest_clone",
      agentsDir: c.agentsDir ?? new URL("../../agents/", import.meta.url).pathname,
    };
  }
  id(): string {
    return `replay:${this.config.mode}${overrideLabel(this.config.overrides)}`;
  }
  async callApi(_prompt: string, context: { vars: { run: number | string } }) {
    const adminUrl = process.env["REPLAY_ADMIN_URL"];
    if (!adminUrl) throw new Error("REPLAY_ADMIN_URL is unset (a superuser URL on the Postgres holding the template)");
    const { mode, overrides, template } = this.config;
    const run = Number(context.vars.run);
    const db = `replay_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const url = Object.assign(new URL(adminUrl), { pathname: `/${db}` }).toString();
    const agents = agentsWith(this.config.agentsDir, overrides);
    try {
      await admin(adminUrl, `CREATE DATABASE ${db} TEMPLATE ${template}`);
      const store = new ArtifactStore(url);
      const refPtr = await store.find(run, OUTPUT[mode]);
      if (!refPtr) throw new Error(`run ${run} has no ${OUTPUT[mode]} to compare against`);
      const reference: unknown = JSON.parse(await store.get(refPtr));
      const t0 = Date.now();
      const r = await replay(mode, store, run, agents);
      return {
        output: JSON.stringify({ mode, run, artifact: r.artifact, failure: r.failure, reference }),
        cost: r.usage.costUsd,
        latencyMs: Date.now() - t0,
        metadata: { usage: r.usage },
      };
    } finally {
      rmSync(agents, { recursive: true, force: true });
      await admin(adminUrl, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
    }
  }
}

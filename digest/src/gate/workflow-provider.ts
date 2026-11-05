import { approveSignal } from "../workflow/signals.js";
import { connect, startDigest } from "../client.js";
import { ArtifactStore } from "../store/artifacts.js";
import { openDb } from "../store/db.js";
import { runCost } from "../store/usage.js";

interface Vars {
  run: number | string;
  date: string;
}

export default class DigestWorkflowProvider {
  private readonly dbUrl: string;
  constructor(options: { config?: { dbUrl?: string } } = {}) {
    const p = options.config?.dbUrl ?? process.env["BAND_DB"];
    if (!p)
      throw new Error("digest-workflow provider needs config.dbUrl or BAND_DB: the scratch DB the worker also uses");
    this.dbUrl = p;
  }
  id(): string {
    return "digest-workflow";
  }
  async callApi(_prompt: string, context: { vars: Vars }) {
    const run = Number(context.vars.run);
    const since = new Date().toISOString().replace("T", " ").slice(0, 19);
    const t0 = Date.now();
    const handle = await startDigest(await connect(), context.vars.date, { resumeRun: run, force: true });
    await handle.signal(approveSignal, { decision: "approve" });
    const result = await handle.result();
    const latencyMs = Date.now() - t0;
    const { costUsd, calls } = await runCost(openDb(this.dbUrl), run, since);
    const store = new ArtifactStore(this.dbUrl);
    const selections = await store.find(run, "selections.json");
    const output = selections ? await store.get(selections) : "";
    return { output, cost: costUsd, latencyMs, metadata: { ...result, calls } };
  }
}

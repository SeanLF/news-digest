import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkDraft, type CheckerShape } from "../activities/coherence.js";
import { agentsWith, overrideLabel, type Overrides } from "./agent-overrides.js";

interface Config {
  fixtureDir: string;
  today: string;
  agentsDir?: string;
  shape?: CheckerShape;
  overrides?: Overrides;
}

export default class CheckerProvider {
  private readonly config: Required<Config>;
  constructor(options: { config?: Partial<Config> } = {}) {
    const c = options.config ?? {};
    if (!c.fixtureDir || !c.today) throw new Error("checker provider needs config.fixtureDir and config.today");
    this.config = {
      fixtureDir: c.fixtureDir,
      today: c.today,
      shape: c.shape ?? "inline-grep",
      agentsDir: c.agentsDir ?? new URL("../../agents/", import.meta.url).pathname,
      overrides: c.overrides ?? {},
    };
  }
  id(): string {
    return `ts-checker:${this.config.shape}${overrideLabel(this.config.overrides)}`;
  }
  async callApi() {
    const dir = this.config.fixtureDir;
    const corpus = readdirSync(dir)
      .filter((n) => /^articles_\d+\.csv$/.test(n) || n === "article_fulltext.json")
      .toSorted()
      .map((n): [string, string] => [n, readFileSync(join(dir, n), "utf8")]);
    const agentsDir = agentsWith(this.config.agentsDir, this.config.overrides);
    try {
      const t0 = Date.now();
      const r = await checkDraft(
        { agentsDir },
        readFileSync(join(dir, "draft_selections.json"), "utf8"),
        corpus,
        this.config.today,
        undefined,
        this.config.shape,
      );
      return {
        output: JSON.stringify(r.report),
        cost: r.costUsd,
        latencyMs: Date.now() - t0,
        metadata: { numTurns: r.numTurns, toolCalls: r.toolCalls, unbackedFails: r.unbacked },
      };
    } finally {
      rmSync(agentsDir, { recursive: true, force: true });
    }
  }
}

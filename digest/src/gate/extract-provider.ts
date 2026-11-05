import { readFileSync } from "node:fs";
import { extract, truncateAtSentence, type Arm } from "../fulltext/extract.js";

export default class ExtractProvider {
  private readonly arm: Arm | "trafilatura";
  constructor(options: { config?: { arm?: Arm | "trafilatura" } } = {}) {
    const arm = options.config?.arm;
    if (!arm) throw new Error("extract provider needs config.arm");
    this.arm = arm;
  }
  id(): string {
    return `extract:${this.arm}`;
  }
  async callApi(
    _prompt: string,
    context: { vars: { html: string; url: string; reference: string; maxChars: number } },
  ) {
    const t0 = Date.now();
    const { html, url, reference, maxChars } = context.vars;
    const text =
      this.arm === "trafilatura"
        ? reference
        : truncateAtSentence(await extract(this.arm, readFileSync(html, "utf8"), url), maxChars);
    return { output: text, latencyMs: Date.now() - t0 };
  }
}

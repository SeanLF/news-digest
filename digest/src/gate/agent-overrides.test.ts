import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentsWith, setFrontmatter } from "./agent-overrides.js";

const AGENT = "---\nname: select\nmodel: claude-sonnet-5-5\nthinking: adaptive\n---\nBody: keep\nmodel: in body\n";

describe("agent overrides", () => {
  it("replaces or adds a frontmatter field and never touches the body", () => {
    const replaced = setFrontmatter(AGENT, "model", "claude-haiku-5-5");
    expect(replaced).toContain("model: claude-haiku-5-5\nthinking");
    expect(replaced).toContain("model: in body");
    expect(setFrontmatter(AGENT, "effort", "high")).toBe("---\nname: select\nmodel: claude-sonnet-5-5\nthinking: adaptive\neffort: high\n---\nBody: keep\nmodel: in body\n");
    expect(() => setFrontmatter("no frontmatter", "effort", "high")).toThrow(/frontmatter/);
  });

  it("copies the agents, applies each stage's overrides, and refuses an unknown stage", () => {
    const src = mkdtempSync(join(tmpdir(), "src-"));
    writeFileSync(join(src, "select.md"), AGENT);
    const dir = agentsWith(src, { select: { effort: "high" } });
    expect(readFileSync(join(dir, "select.md"), "utf8")).toContain("effort: high");
    expect(readFileSync(join(src, "select.md"), "utf8")).not.toContain("effort");
    expect(() => agentsWith(src, { selekt: { effort: "high" } })).toThrow(/no agent file for stage "selekt"/);
  });
});

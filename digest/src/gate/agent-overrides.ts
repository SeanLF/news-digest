// A variant of the stage prompts for a replay: a copy of the agents directory with frontmatter fields
// overridden per stage ({ select: { effort: "high" } }). The body is never touched.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Overrides = Record<string, Record<string, string>>;

export function setFrontmatter(md: string, field: string, value: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("agent file has no frontmatter");
  const lines = m[1]!.split("\n");
  const i = lines.findIndex((l) => l.split(":", 1)[0]!.trim() === field);
  if (i >= 0) lines[i] = `${field}: ${value}`;
  else lines.push(`${field}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${md.slice(m[0].length)}`;
}

// A fresh directory under the OS temp dir; refuses a stage with no agent file, so a typo is not a no-op.
export function agentsWith(src: string, overrides: Overrides = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "agents-"));
  try {
    cpSync(src, dir, { recursive: true });
    for (const [stage, fields] of Object.entries(overrides)) {
      const f = join(dir, `${stage}.md`);
      if (!existsSync(f)) throw new Error(`no agent file for stage ${JSON.stringify(stage)}`);
      let md = readFileSync(f, "utf8");
      for (const [field, value] of Object.entries(fields)) md = setFrontmatter(md, field, value);
      writeFileSync(f, md);
    }
    return dir;
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

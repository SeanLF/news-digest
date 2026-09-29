import { parse as parseYaml } from "yaml";
import { z } from "zod";

// Read and Grep on the input directory only (spec §2.2): publisher text reaches a model with
// nothing to mutate and nothing to exfiltrate to. Write is gone by contract: the result is the
// final message.
const StageToolSchema = z.enum(["Read", "Grep"]);
export type StageTool = z.infer<typeof StageToolSchema>;
const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;

// An agent file's frontmatter. `tools` is a comma list ("Read, Grep") or empty.
const FrontmatterSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  model: z.string().min(1),
  thinking: z.enum(["adaptive", "disabled"]),
  tools: z.string().nullish().transform((t, ctx) => {
    const named = (t ?? "").split(/[,\s]+/).filter(Boolean);
    const bad = named.filter((x) => !StageToolSchema.safeParse(x).success);
    if (bad.length) ctx.addIssue({ code: "custom", message: `names tools the contract removed: ${bad.join(", ")}` });
    return named as StageTool[];
  }),
  effort: EffortSchema.optional(),
});

export interface StageSpec {
  name: string;
  model: string;
  thinking: "adaptive" | "disabled";
  tools: StageTool[];
  body: string;
  effort?: Effort;
}

export function parseAgentSpec(markdown: string): StageSpec {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown.trimStart());
  if (!m) throw new Error("agent spec has no frontmatter");
  const parsed = FrontmatterSchema.safeParse(parseYaml(m[1]!) ?? {});
  if (!parsed.success) throw new Error(`agent spec frontmatter: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  const { name, model, thinking, tools, effort } = parsed.data;
  return { name, model, thinking, tools, body: m[2]!.trim(), ...(effort ? { effort } : {}) };
}

const TOKEN = /\{\{([^{}]*)\}\}/g;

export function renderBody(body: string, todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`not a date: ${todayIso}`);
  const pretty = d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const out = body.replaceAll("{{CURRENT_DATE}}", pretty);
  const left = [...out.matchAll(TOKEN)].map((m) => m[1]);
  if (left.length) throw new Error(`unrendered token(s): ${[...new Set(left)].join(", ")}`);
  return out;
}

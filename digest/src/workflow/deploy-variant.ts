import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function variant(name: string, anchor: string, replacement: string, what: string): string {
  const src = readFileSync(join(here, "digest.workflow.ts"), "utf8");
  if (!src.includes(anchor))
    throw new Error(`${what}'s anchor is gone from digest.workflow.ts; update deploy-variant.ts`);
  const changed = src
    .replace(anchor, replacement)
    .replaceAll('from "./', `from "${here}/`)
    .replaceAll('from "../', `from "${dirname(here)}/`);
  const dir = join(here, "..", "..", "dist", name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "digest.workflow.ts");
  writeFileSync(path, changed);
  return path;
}

const BUDGET = "    const budget = sendBudget();\n";
export const changedWorkflowPath = (): string =>
  variant(
    "deploy-variant",
    BUDGET,
    `    await ops.healthcheckLog("added by a later deploy");\n${BUDGET}`,
    "the budget check",
  );

const PARKED_PATCH = "retryDecisions.length === 0 && patched(PARKED_ALERT_PATCH)";
export const unpatchedWorkflowPath = (): string =>
  variant("unpatched-variant", PARKED_PATCH, "retryDecisions.length === 0", "the parked alert's patch");

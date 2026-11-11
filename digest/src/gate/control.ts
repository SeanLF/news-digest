import type { Plant } from "./plant.js";
import type { JudgeVerdict } from "./verdict.js";

export const CONTROL_MIN_RECALL = 0.8;

const reEscape = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentions(text: string, marker: string): boolean {
  return new RegExp(`(?<![\\w.])${reEscape(marker)}(?!\\w)`, "i").test(text.replaceAll(/(?<=\d),(?=\d{3})/g, ""));
}

export function catches(p: Plant, run: JudgeVerdict[]): boolean {
  return run.some(
    (v) =>
      v.story === p.storyIndex && (v.criterion === 1 || v.criterion === 2) && !v.pass && mentions(v.reason, p.marker),
  );
}

export function controlResult(
  plants: Plant[],
  runs: (JudgeVerdict[] | null)[],
): { caught: number; total: number; recall: number; pass: boolean } {
  const total = plants.length * runs.length;
  let caught = 0;
  for (const run of runs) for (const p of plants) if (run && catches(p, run)) caught++;
  const recall = total ? caught / total : 0;
  return { caught, total, recall, pass: total > 0 && recall >= CONTROL_MIN_RECALL };
}

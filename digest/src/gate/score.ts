import type { CoherenceReport } from "../contracts/coherence.js";
import type { Plant } from "./plant.js";

export function recallOnPlants(plants: Plant[], report: CoherenceReport): { caught: number; total: number } {
  let caught = 0;
  for (const p of plants) {
    const r = report.results[p.storyIndex];
    if (r && !r.pass && (r.failed_fields ?? []).includes(p.field)) caught++;
  }
  return { caught, total: plants.length };
}

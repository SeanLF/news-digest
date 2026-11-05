import type { Duration } from "@temporalio/common";
import type { Pointer } from "../store/artifacts.js";
import { threadsPhase } from "./threads.js";

export async function ThreadsPhaseProbe(runId: number, bound: Duration): Promise<Pointer> {
  return threadsPhase(runId, false, bound);
}

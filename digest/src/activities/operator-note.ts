import { createHash } from "node:crypto";
import type { ArtifactStore } from "../store/artifacts.js";

export async function recordOperatorNote(
  store: ArtifactStore,
  runId: number,
  stage: string,
  note: string | undefined,
): Promise<void> {
  if (!note?.trim()) return;
  const digest = createHash("sha256").update(note).digest("hex").slice(0, 12);
  await store.put(runId, `operator_note.${stage}.${digest}.txt`, note);
}

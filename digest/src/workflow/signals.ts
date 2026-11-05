import { defineSignal } from "@temporalio/workflow";
export const approveSignal = defineSignal<[{ decision: "approve" | "reject" }]>("approve");
export const retrySignal = defineSignal<[{ decision: "retry" | "abort" }]>("retry");
export const operatorNoteSignal = defineSignal<[{ stage: string; note: string }]>("operatorNote");

import { runStage } from "../runner/run-stage.js";
const r = await runStage(
  {
    name: "smoke",
    model: "claude-haiku-5-5",
    thinking: "disabled",
    tools: [],
    body: 'Reply with exactly the JSON {"ok": true} and nothing else.',
  },
  { userMessage: "Begin.", inputDir: process.cwd() },
  {
    today: new Date().toISOString().slice(0, 10),
    outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  },
);
console.log(JSON.stringify(r));

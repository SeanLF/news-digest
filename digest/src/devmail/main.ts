import { serve } from "@hono/node-server";
import { log } from "../log.js";
import { resendFake } from "./fake.js";

const port = Number(process.env["PORT"] ?? 8025);
const stateFile = process.env["RESEND_FAKE_STATE"] || undefined;
const fake = resendFake(stateFile ? { stateFile } : {});
const server = serve({ fetch: fake.app.fetch, port, hostname: "0.0.0.0" }, () =>
  log.info({ devmail: "listening", port, state: stateFile ?? "memory" }),
);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close(() => process.exit(0)));

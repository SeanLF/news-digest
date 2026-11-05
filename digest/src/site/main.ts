import { serve } from "@hono/node-server";
import { Resend } from "resend";
import { log } from "../log.js";
import { dbUrl, openDb } from "../store/db.js";
import { siteApp } from "./app.js";
import { loadAssets } from "./assets.js";
import { ConfigError, siteConfig, subscriptionsEnabled } from "./config.js";
import { loadCatalogue } from "./sources.js";
import { siteStore } from "./store.js";

let cfg;
try {
  cfg = siteConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    log.error({ site: "config", error: e.message });
    process.exit(1);
  }
  throw e;
}
const app = siteApp({
  cfg,
  assets: loadAssets(cfg.designDir),
  catalogue: loadCatalogue(cfg.sourcesFile),
  data: siteStore(openDb(dbUrl())),
  mail: subscriptionsEnabled(cfg) ? new Resend(cfg.resendApiKey, { baseUrl: cfg.resendBaseUrl! }) : undefined,
  now: () => new Date(),
});
const port = Number(process.env["PORT"] ?? 8080);
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => log.info({ site: "listening", port }));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

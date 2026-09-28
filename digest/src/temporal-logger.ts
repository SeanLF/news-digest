import { DefaultLogger, type LogEntry } from "@temporalio/worker";
import type { Logger } from "pino";

// Only worker.ts needs this: @temporalio/worker is pipeline machinery the site process must never
// import (src/site/units.test.ts's boundary check), so this stays out of log.ts, which the site's
// modules also import for the shared logger.
type Level = "debug" | "info" | "warn" | "error";

export const temporalLogger = (logger: Logger): DefaultLogger =>
  new DefaultLogger("INFO", (e: LogEntry) => logger[e.level.toLowerCase() as Level | "trace"](e.meta ?? {}, e.message));

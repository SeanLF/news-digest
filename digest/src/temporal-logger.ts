import { DefaultLogger, type LogEntry } from "@temporalio/worker";
import type { Logger } from "pino";

type Level = "debug" | "info" | "warn" | "error";

export const temporalLogger = (logger: Logger): DefaultLogger =>
  new DefaultLogger("INFO", (e: LogEntry) => logger[e.level.toLowerCase() as Level | "trace"](e.meta ?? {}, e.message));

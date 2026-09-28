import { format } from "node:util";
import { DefaultLogger, type LogEntry } from "@temporalio/worker";
import { destination, pino, stdSerializers, type DestinationStream, type Logger } from "pino";

export function createLogger(dest: DestinationStream = destination({ sync: true })): Logger {
  return pino(
    { level: "debug", base: null, timestamp: false, formatters: { level: (label) => ({ level: label }) }, serializers: { err: stdSerializers.err, error: stdSerializers.err } },
    dest,
  );
}

function asObject(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length !== 1 || typeof args[0] !== "string" || !args[0].startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(args[0]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

type Level = "debug" | "info" | "warn" | "error";
export function jsonConsole(logger: Logger): Pick<Console, "log" | "info" | "warn" | "error" | "debug"> {
  const at = (level: Level) => (...args: unknown[]) => {
    const obj = asObject(args);
    if (obj) {
      const { level: _own, ...fields } = obj;
      logger[level](fields);
    } else logger[level](format(...args));
  };
  return { log: at("info"), info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") };
}

export const temporalLogger = (logger: Logger): DefaultLogger =>
  new DefaultLogger("INFO", (e: LogEntry) => logger[e.level.toLowerCase() as Level | "trace"](e.meta ?? {}, e.message));

export function installJsonLogging(): DefaultLogger {
  const logger = createLogger();
  Object.assign(console, jsonConsole(logger));
  return temporalLogger(logger);
}

import { format, inspect } from "node:util";
import { DefaultLogger, type LogEntry } from "@temporalio/worker";

type Level = "debug" | "info" | "warn" | "error";
type Write = (line: string) => void;

const replacer = (_k: string, v: unknown): unknown =>
  v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : typeof v === "bigint" ? v.toString() : v;

function serialise(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, replacer);
  } catch {
    return JSON.stringify({ level: value["level"], msg: inspect(value, { depth: 4, breakLength: Infinity }) });
  }
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

export function jsonLine(level: Level, args: unknown[]): string {
  const obj = asObject(args);
  return `${serialise(obj ? { ...obj, level } : { level, msg: format(...args) })}\n`;
}

export function jsonConsole(write: Write): Pick<Console, "log" | "info" | "warn" | "error" | "debug"> {
  return {
    log: (...a: unknown[]) => write(jsonLine("info", a)),
    info: (...a: unknown[]) => write(jsonLine("info", a)),
    warn: (...a: unknown[]) => write(jsonLine("warn", a)),
    error: (...a: unknown[]) => write(jsonLine("error", a)),
    debug: (...a: unknown[]) => write(jsonLine("debug", a)),
  };
}

export const temporalLogger = (write: Write): DefaultLogger =>
  new DefaultLogger("INFO", (e: LogEntry) => write(`${serialise({ ...e.meta, level: e.level.toLowerCase(), msg: e.message })}\n`));

const stdout: Write = (line) => void process.stdout.write(line);

export function installJsonLogging(): DefaultLogger {
  Object.assign(console, jsonConsole(stdout));
  return temporalLogger(stdout);
}

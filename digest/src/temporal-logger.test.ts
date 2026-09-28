import { describe, expect, it } from "vitest";
import { createLogger } from "./log.js";
import { temporalLogger } from "./temporal-logger.js";

const capture = () => {
  const out: string[] = [];
  const logger = createLogger({ write: (s: string) => void out.push(s) });
  const lines = () => out.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { out, logger, lines };
};

describe("temporalLogger", () => {
  it("writes an entry as one line with its level, message and meta", () => {
    const { logger, lines } = capture();
    temporalLogger(logger).warn("Activity failed", { attempt: 1, taskQueue: "digest" });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({ level: "warn", msg: "Activity failed", attempt: 1, taskQueue: "digest" });
  });

  it("keeps an error's type and message", () => {
    const { logger, lines } = capture();
    temporalLogger(logger).error("Activity failed", { error: new TypeError("timed out after 15000 ms") });
    expect(lines()[0]!["error"]).toMatchObject({ type: "TypeError", message: "timed out after 15000 ms" });
  });

  it("writes a circular meta instead of throwing, keeping the other fields", () => {
    const { logger, lines } = capture();
    const loop: Record<string, unknown> = { name: "loop" };
    loop["self"] = loop;
    expect(() => temporalLogger(logger).error("Worker failed", { attempt: 3, error: loop })).not.toThrow();
    expect(lines()[0]).toMatchObject({ level: "error", msg: "Worker failed", attempt: 3 });
  });

  it("writes a line even when a value's toJSON throws", () => {
    const { logger, lines } = capture();
    const bad = { toJSON: () => { throw new Error("boom"); } };
    expect(() => temporalLogger(logger).warn("Activity failed", { taskQueue: "digest", context: bad })).not.toThrow();
    expect(lines()[0]).toMatchObject({ level: "warn" });
  });

  it("drops entries below INFO", () => {
    const { out, logger } = capture();
    temporalLogger(logger).debug("noise");
    expect(out).toEqual([]);
  });
});

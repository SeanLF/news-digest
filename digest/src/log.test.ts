import { describe, expect, it } from "vitest";
import { createLogger, jsonConsole, temporalLogger } from "./log.js";

const capture = () => {
  const out: string[] = [];
  const logger = createLogger({ write: (s: string) => void out.push(s) });
  const lines = () => out.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { out, logger, lines };
};

describe("jsonConsole", () => {
  it("maps each console method to its level, one JSON line per call, the level as a word", () => {
    const { out, logger, lines } = capture();
    const c = jsonConsole(logger);
    c.log("a");
    c.info("b");
    c.warn("c");
    c.error("d");
    c.debug("e");
    expect(out.every((l) => l.trimEnd().split("\n").length === 1)).toBe(true);
    expect(lines().map((l) => l["level"])).toEqual(["info", "info", "warn", "error"]);
  });

  it("keeps a JSON-object line's fields, and the call's level wins over its own", () => {
    const { logger, lines } = capture();
    jsonConsole(logger).warn(JSON.stringify({ stage: "gnews", warning: "x", level: "info" }));
    expect(lines()[0]).toMatchObject({ level: "warn", stage: "gnews", warning: "x" });
  });

  it("formats plain arguments as console would, as msg", () => {
    const { logger, lines } = capture();
    jsonConsole(logger).error("run %d failed:", 7, "boom");
    expect(lines()[0]).toMatchObject({ level: "error", msg: "run 7 failed: boom" });
  });

  it("keeps a multi-line message on one line", () => {
    const { out, logger, lines } = capture();
    jsonConsole(logger).info("one\ntwo");
    expect(out[0]!.trimEnd()).not.toContain("\n");
    expect(lines()[0]!["msg"]).toBe("one\ntwo");
  });
});

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

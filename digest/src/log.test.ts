import { describe, expect, it } from "vitest";
import { jsonConsole, jsonLine, temporalLogger } from "./log.js";

const parse = (line: string): Record<string, unknown> => JSON.parse(line) as Record<string, unknown>;

const lines = () => {
  const out: string[] = [];
  return { out, write: (s: string) => void out.push(s) };
};

describe("jsonLine", () => {
  it("merges a level into a line that is already a JSON object", () => {
    expect(parse(jsonLine("warn", [JSON.stringify({ stage: "gnews", warning: "x" })]))).toEqual({ level: "warn", stage: "gnews", warning: "x" });
  });

  it("wraps plain text as msg, formatted as console would", () => {
    expect(parse(jsonLine("error", ["run %d failed:", 7, "boom"]))).toEqual({ level: "error", msg: "run 7 failed: boom" });
  });

  it("keeps a multi-line message on one line", () => {
    const line = jsonLine("info", ["one\ntwo"]);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd()).not.toContain("\n");
    expect(parse(line)["msg"]).toBe("one\ntwo");
  });

  it("does not let a line's own level override the call's", () => {
    expect(parse(jsonLine("error", [JSON.stringify({ level: "info", stage: "s" })]))["level"]).toBe("error");
  });

  it("wraps a JSON array or scalar as msg", () => {
    expect(parse(jsonLine("info", ["[1,2]"]))).toEqual({ level: "info", msg: "[1,2]" });
  });
});

describe("jsonConsole", () => {
  it("maps each console method to its level, one JSON line per call", () => {
    const { out, write } = lines();
    const c = jsonConsole(write);
    c.log("a");
    c.info("b");
    c.warn("c");
    c.error("d");
    c.debug("e");
    expect(out.map((l) => parse(l)["level"])).toEqual(["info", "info", "warn", "error", "debug"]);
  });
});

describe("temporalLogger", () => {
  it("writes an entry as one JSON line with its level, message and meta", () => {
    const { out, write } = lines();
    temporalLogger(write).warn("Activity failed", { attempt: 1, taskQueue: "digest" });
    expect(out).toHaveLength(1);
    expect(parse(out[0]!)).toMatchObject({ level: "warn", msg: "Activity failed", attempt: 1, taskQueue: "digest" });
  });

  it("keeps an error's name and message, which JSON.stringify drops", () => {
    const { out, write } = lines();
    temporalLogger(write).error("Activity failed", { error: new TypeError("timed out after 15000 ms") });
    expect(parse(out[0]!)["error"]).toMatchObject({ name: "TypeError", message: "timed out after 15000 ms" });
  });

  it("drops entries below INFO", () => {
    const { out, write } = lines();
    temporalLogger(write).debug("noise");
    expect(out).toEqual([]);
  });
});

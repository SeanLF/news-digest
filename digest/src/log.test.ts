import { describe, expect, it } from "vitest";
import { createLogger } from "./log.js";

describe("createLogger", () => {
  it("writes JSON, one line per call, the level as a word", () => {
    const out: string[] = [];
    const logger = createLogger({ write: (s: string) => void out.push(s) });
    logger.info("a");
    logger.warn({ stage: "x" }, "b");
    expect(out).toHaveLength(2);
    const lines = out.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ level: "info", msg: "a" });
    expect(lines[1]).toMatchObject({ level: "warn", stage: "x", msg: "b" });
  });
});

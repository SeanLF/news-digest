import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { agentsWith } from "./agent-overrides.js";

describe("replay provider", () => {
  it("an override naming an unknown stage leaves no copied directory behind", () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("agents-")).length;
    expect(() => agentsWith(new URL("../../agents/", import.meta.url).pathname, { selekt: { effort: "high" } })).toThrow(/selekt/);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("agents-")).length).toBe(before);
  });
});

import { describe, expect, it } from "vitest";
import { parseAgentSpec, renderBody } from "./prompt.js";

const MD = `---
name: coherence
tools: Read, Grep
model: claude-sonnet-5
thinking: adaptive
---

Today is {{CURRENT_DATE}}. Reply with {"results": []}.`;

describe("prompt", () => {
  it("parses frontmatter and body", () => {
    const s = parseAgentSpec(MD);
    expect(s).toMatchObject({ name: "coherence", model: "claude-sonnet-5", tools: ["Read", "Grep"], thinking: "adaptive" });
    expect(s.body.startsWith("Today is")).toBe(true);
  });
  it("reads an effort level when the frontmatter names one, and refuses one the SDK does not know", () => {
    expect(parseAgentSpec(MD).effort).toBeUndefined();
    expect(parseAgentSpec(MD.replace("thinking: adaptive", "thinking: adaptive\neffort: high")).effort).toBe("high");
    expect(() => parseAgentSpec(MD.replace("thinking: adaptive", "thinking: adaptive\neffort: extreme"))).toThrow(/effort/);
  });
  it("refuses a tool the contract removed", () => {
    expect(() => parseAgentSpec(MD.replace("Read, Grep", "Read, Write"))).toThrow(/Write/);
  });
  it("renders the date and leaves JSON braces alone", () => {
    const out = renderBody(parseAgentSpec(MD).body, "2026-09-21");
    expect(out).toContain("Today is Monday, September 21, 2026");
    expect(out).toContain('{"results": []}');
  });
  it("refuses an unrendered token and a bad date", () => {
    expect(() => renderBody("x {{OTHER}} y", "2026-09-21")).toThrow(/OTHER/);
    expect(() => renderBody("x", "yesterday")).toThrow(/date/);
  });
});

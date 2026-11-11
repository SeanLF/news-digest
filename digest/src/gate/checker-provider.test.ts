import { describe, expect, it } from "vitest";
import CheckerProvider from "./checker-provider.js";

describe("checker provider", () => {
  it("names its overrides, so two arms of one experiment are told apart in the results", () => {
    const base = { fixtureDir: "/f", today: "2026-08-28" };
    expect(new CheckerProvider({ config: base }).id()).toBe("ts-checker:inline-grep");
    expect(
      new CheckerProvider({
        config: { ...base, shape: "read-loop", overrides: { coherence: { model: "claude-haiku-5-5" } } },
      }).id(),
    ).toBe("ts-checker:read-loop:coherence.model=claude-haiku-5-5");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as blobs from "./pages/blobs.js";

// docs/design-system.md, "Type scale": the base steps, 13 for the chrome nav, and the mobile and desktop tiers.
const SCALE = new Set([12, 13, 14, 16, 17, 18, 20, 22, 23, 25, 27, 29, 30, 34]);
// Relative sizes scale an element already on the scale.
const RELATIVE = /^(inherit|1em|100%)$/;

const offScale = (css: string): string[] =>
  [...css.matchAll(/font-size\s*:\s*([^;}]+)/g)]
    .map((m) => m[1]!.trim())
    .filter((v) => !RELATIVE.test(v) && !(/^\d+px$/.test(v) && SCALE.has(Number.parseInt(v, 10))));

// design/tokens.css, "motion": a duration is a token, never a literal; a loop (the skeleton pulse) is exempt.
const literalTimings = (css: string): string[] =>
  [...css.matchAll(/(?:transition|animation)\s*:([^;}"]+)/g)]
    .map((m) => m[1]!.trim())
    .filter((v) => !v.includes("infinite") && /(^|[\s,(])\.?\d*\.?\d+m?s\b/.test(v));

const sheets: [string, string][] = [
  ["digest.css", readFileSync(new URL("../../templates/digest.css", import.meta.url), "utf8")],
  ...Object.entries(blobs).filter((e): e is [string, string] => e[0].endsWith("Css") && typeof e[1] === "string"),
];

describe("the design scale", () => {
  it.each(sheets)("%s sets every font size on the type scale", (_name, css) => {
    expect(offScale(css)).toEqual([]);
  });
  it.each(sheets)("%s times every transition and animation with the motion tokens", (_name, css) => {
    expect(literalTimings(css)).toEqual([]);
  });
  it("catches a size off the scale", () => {
    expect(offScale("a{font-size:15px} b{font-size:0.9rem} c{font-size:14px}")).toEqual(["15px", "0.9rem"]);
  });
  it("catches a literal timing, and passes a token and a loop", () => {
    const css = "a{transition:opacity .2s ease} b{transition:color 150ms} c{transition:opacity var(--dur-1) var(--ease)} d{animation:pulse 1s infinite}";
    expect(literalTimings(css)).toEqual(["opacity .2s ease", "color 150ms"]);
  });
});

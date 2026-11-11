import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
const pkg = z.object({ overrides: z.record(z.string(), z.string()).optional() }).parse(read("package.json"));
const lock = z
  .object({ packages: z.record(z.string(), z.object({ version: z.string().optional() })) })
  .parse(read("package-lock.json")).packages;

describe("npm overrides", () => {
  it("forces fast-xml-parser past feedsmith 3.0.1's ~5.11.1 to 5.12.0 for GHSA-474x-hrwr-fgx4; when feedsmith moves, drop the override if its range admits 5.12.0", () => {
    expect(lock["node_modules/feedsmith"]?.version).toBe("3.0.1");
    expect(pkg.overrides).toEqual({ "fast-xml-parser": "5.12.0" });
    const copies = Object.entries(lock)
      .filter(([path]) => path.endsWith("node_modules/fast-xml-parser"))
      .map(([, entry]) => entry.version);
    expect(copies).toEqual(["5.12.0"]);
  });
});

import { defineConfig } from "vitest/config";
// Two projects. `unit` is every test that needs no Temporal server, the pre-commit hook's run
// (bin/ci --staged). `temporal` is the files that start one (*.temporal.test.ts), most of a minute,
// run by a full bin/ci: pre-push and GitHub CI. The globs are complements, so no test is in neither.
// The first test in each file starts that worker's PGlite and applies the schema, which took 5.2-6.4 s
// with the host's load average near 15 (2026-09-23), past vitest's 5 s default: eight files failed
// on their first test and passed alone.
const TEMPORAL = "src/**/*.temporal.test.ts";
export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      { extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], exclude: [TEMPORAL] } },
      { extends: true, test: { name: "temporal", include: [TEMPORAL] } },
    ],
  },
});

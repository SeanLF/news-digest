import { describe, expect, it } from "vitest";
import { openDb, type Db } from "../store/db.js";
import { freshDb } from "../store/test-db.js";
import { feedHealthAlert, FROZEN_DAYS } from "./feed-health.js";

async function seed(rows: [source: string, success: number, minutesAgo: number, runId: number][]): Promise<Db> {
  const db = openDb(await freshDb([299, 300, 301]));
  for (const [s, ok, ago, run] of rows)
    await db.run(
      "INSERT INTO source_fetches (source_id, is_success, fetched_at, run_id) VALUES ($1, $2, now() - make_interval(mins => $3), $4)",
      [s, ok === 1, ago, run],
    );
  return db;
}

async function keptDb(
  sources: [source: string, firstSeenDaysAgo: number, lastKeptDaysAgo: number | null][],
  keptThisRun = 0,
): Promise<Db> {
  const db = openDb(await freshDb([299, 300, 301]));
  for (const [s, firstSeen, lastKept] of sources)
    for (let ago = firstSeen; ago >= 0; ago--)
      await db.run(
        "INSERT INTO source_fetches (source_id, is_success, articles_fetched, articles_kept, fetched_at, run_id) VALUES ($1, true, 300, $2, now() - make_interval(mins => $3), $4)",
        [
          s,
          ago === 0 ? keptThisRun : ago === lastKept ? 5 : 0,
          ago * 1440 + 1,
          ago === 0 ? 301 : ago === 1 ? 300 : 299,
        ],
      );
  return db;
}

describe("feedHealthAlert", () => {
  it("names the fetched sources whose latest failures in a row reach the threshold, worst first", async () => {
    const db = await seed([
      ["the_hindu", 0, 1, 301],
      ["the_hindu", 0, 1440, 300],
      ["the_hindu", 0, 2880, 300],
      ["the_hindu", 0, 4320, 300],
      ["france24", 0, 1, 301],
      ["france24", 0, 1440, 300],
      ["france24", 0, 2880, 300],
      ["france24", 1, 4320, 300],
      ["bbc", 0, 1, 301],
      ["bbc", 1, 1440, 300],
      ["bbc", 0, 2880, 300],
      ["bbc", 0, 4320, 300],
      ["reuters", 1, 1, 301],
    ]);
    expect(await feedHealthAlert(db, 301, ["the_hindu", "france24", "bbc", "reuters"], 3)).toEqual({
      kind: "source-health",
      failing: [
        ["the_hindu", 4],
        ["france24", 3],
      ],
      frozen: [],
      frozenDays: FROZEN_DAYS,
      failedThisRun: 3,
      totalSources: 4,
      threshold: 3,
      started: ["france24"],
      recovered: [],
    });
  });
  it("is silent when the failing set is the one the previous run already reported, longer streaks or not", async () => {
    const db = await seed([
      ["the_hindu", 0, 1, 301],
      ["the_hindu", 0, 1440, 300],
      ["the_hindu", 0, 2880, 299],
      ["the_hindu", 0, 4320, 299],
      ["bbc", 1, 1, 301],
      ["bbc", 1, 1440, 300],
    ]);
    expect(await feedHealthAlert(db, 300, ["the_hindu", "bbc"], 3)).toMatchObject({ failing: [["the_hindu", 3]] });
    expect(await feedHealthAlert(db, 301, ["the_hindu", "bbc"], 3)).toBeNull();
  });
  it("alerts when a source joins the failing set, naming it and any that recovered", async () => {
    const db = await seed([
      ["the_hindu", 1, 1, 301],
      ["the_hindu", 0, 1440, 300],
      ["the_hindu", 0, 2880, 299],
      ["the_hindu", 0, 4320, 299],
      ["bbc", 0, 1, 301],
      ["bbc", 0, 1440, 300],
      ["bbc", 0, 2880, 299],
      ["france24", 0, 1, 301],
      ["france24", 0, 1440, 300],
      ["france24", 0, 2880, 299],
      ["france24", 0, 4320, 299],
    ]);
    expect(await feedHealthAlert(db, 301, ["the_hindu", "bbc", "france24"], 3)).toMatchObject({
      failing: [
        ["france24", 4],
        ["bbc", 3],
      ],
      started: ["bbc"],
      recovered: ["the_hindu"],
    });
  });
  it("leaves out a parked source: its failures are history, not news", async () => {
    const db = await seed([
      ["parked", 0, 1, 301],
      ["parked", 0, 1440, 300],
      ["parked", 0, 2880, 300],
    ]);
    expect(await feedHealthAlert(db, 301, ["reuters"], 3)).toBeNull();
  });
  it(`counts a source that served nothing new for ${FROZEN_DAYS} days as failing, by days since it last kept an article`, async () => {
    const db = await keptDb([
      ["rest_of_world", FROZEN_DAYS + 2, FROZEN_DAYS],
      ["economist", FROZEN_DAYS + 2, FROZEN_DAYS - 1],
      ["never_new", FROZEN_DAYS + 3, null],
      ["reuters", 2, 1],
    ]);
    expect(await feedHealthAlert(db, 301, ["rest_of_world", "economist", "never_new", "reuters"], 3)).toEqual({
      kind: "source-health",
      failing: [],
      frozen: [
        ["never_new", FROZEN_DAYS + 3],
        ["rest_of_world", FROZEN_DAYS],
      ],
      frozenDays: FROZEN_DAYS,
      failedThisRun: 0,
      totalSources: 4,
      threshold: 3,
      started: ["rest_of_world"],
      recovered: [],
    });
  });
  it("a frozen source that keeps an article again recovers", async () => {
    const db = await keptDb([["rest_of_world", FROZEN_DAYS + 2, FROZEN_DAYS + 1]], 3);
    for (let ago = FROZEN_DAYS + 2; ago >= 0; ago--)
      await db.run(
        "INSERT INTO source_fetches (source_id, is_success, articles_fetched, articles_kept, fetched_at, run_id) VALUES ('frozen', true, 20, 0, now() - make_interval(mins => $1), $2)",
        [ago * 1440 + 1, ago === 0 ? 301 : ago === 1 ? 300 : 299],
      );
    expect(await feedHealthAlert(db, 301, ["rest_of_world", "frozen"], 3)).toMatchObject({
      frozen: [["frozen", FROZEN_DAYS + 2]],
      started: [],
      recovered: ["rest_of_world"],
    });
  });
  it("a source failing outright is listed by its failures, not as frozen too", async () => {
    const db = await seed([
      ["dead", 0, 1, 301],
      ["dead", 0, 1440, 300],
      ["dead", 0, 2880, 300],
      ["dead", 1, (FROZEN_DAYS + 2) * 1440, 300],
    ]);
    expect(await feedHealthAlert(db, 301, ["dead"], 3)).toMatchObject({ failing: [["dead", 3]], frozen: [] });
  });
  it("a fetch with no kept count recorded is not evidence the source froze", async () => {
    const db = await seed([
      ["legacy", 1, 1, 301],
      ["legacy", 1, (FROZEN_DAYS + 2) * 1440, 300],
    ]);
    expect(await feedHealthAlert(db, 301, ["legacy"], 3)).toBeNull();
  });
  it("ignores sources not seen in the last seven days", async () => {
    const db = await seed([
      ["old", 0, 8 * 1440, 300],
      ["old", 0, 9 * 1440, 300],
      ["old", 0, 10 * 1440, 300],
    ]);
    expect(await feedHealthAlert(db, 301, ["old"], 3)).toBeNull();
  });
});

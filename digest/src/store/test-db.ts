import { openDb, registerDb } from "./db.js";
import { emptyPglite, pgliteDb } from "./pglite.js";
import { RESET_IDENTITIES } from "./schema.js";

let generation = 0;
export async function migratedDb(runs: { id: number; runAt: string }[] = []): Promise<string> {
  const pg = await emptyPglite();
  const key = `pglite:${++generation}`;
  const mine = generation;
  registerDb(key, () => {
    if (mine !== generation) throw new Error(`${key} was emptied for a newer test database`);
    return pgliteDb(pg);
  });
  const db = openDb(key);
  for (const r of runs) await db.run("INSERT INTO runs (id, started_at) VALUES ($1, $2)", [r.id, r.runAt]);
  await db.exec(RESET_IDENTITIES);
  return key;
}

export const freshDb = (runIds: number[] = [300]): Promise<string> =>
  migratedDb(runIds.map((id) => ({ id, runAt: "2026-09-18 10:25:40" })));

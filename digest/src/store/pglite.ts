import { PGlite } from "@electric-sql/pglite";
import { PARSERS, type Db, type Sql } from "./db.js";
import { upSections } from "./schema.js";

let instance: Promise<PGlite> | undefined;
async function start(): Promise<PGlite> {
  const db = new PGlite({ parsers: PARSERS });
  await db.exec("SET TIME ZONE 'UTC'");
  for (const up of upSections()) await db.exec(up);
  return db;
}
export const pglite = (): Promise<PGlite> => (instance ??= start());

export async function emptyPglite(): Promise<PGlite> {
  const db = await pglite();
  const { rows } = await db.query<{ t: string }>(
    "SELECT string_agg(quote_ident(tablename), ', ') AS t FROM pg_tables WHERE schemaname = 'public'",
  );
  await db.exec(`TRUNCATE ${rows[0]!.t} RESTART IDENTITY CASCADE`);
  return db;
}

const LOCK = "SELECT pg_advisory_xact_lock(hashtext($1))";
type Querier = Pick<PGlite, "query" | "exec">;
function sqlOn(q: Querier): Sql {
  return {
    all: async <T>(text: string, params?: unknown[]) => (await q.query<T>(text, params)).rows,
    one: async <T>(text: string, params?: unknown[]) => (await q.query<T>(text, params)).rows[0],
    run: async (text: string, params?: unknown[]) => (await q.query(text, params)).affectedRows ?? 0,
    exec: async (text: string) => {
      await q.exec(text);
    },
  };
}

export function pgliteDb(db: PGlite): Db {
  return {
    ...sqlOn(db),
    tx: (fn, lock) =>
      db.transaction(async (t) => {
        if (lock !== undefined) await t.query(LOCK, [lock]);
        return fn(sqlOn(t));
      }),
  };
}

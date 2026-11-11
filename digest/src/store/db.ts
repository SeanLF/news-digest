import type { Selectable } from "kysely";
import pg from "pg";
import { log } from "../log.js";
import type { DB } from "./schema.gen.js";

export function dbUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env["DIGEST_DATABASE_URL"]?.trim();
  if (!url) throw new Error("DIGEST_DATABASE_URL is unset: it names the product Postgres database");
  return url;
}

export type RowOf<T extends keyof DB> = Selectable<DB[T]>;
export interface Sql {
  all<T = unknown>(text: string, params?: unknown[]): Promise<T[]>;
  one<T = unknown>(text: string, params?: unknown[]): Promise<T | undefined>;
  run(text: string, params?: unknown[]): Promise<number>;
  exec(text: string): Promise<void>;
}
export interface Db extends Sql {
  tx<T>(fn: (t: Sql) => Promise<T>, lock?: string): Promise<T>;
}

export function utcText(v: string): string {
  const iso = v.replace(" ", "T");
  const d = new Date(/(?:[+-]\d\d(?::?\d\d)?|Z)$/.test(iso) ? iso.replace(/([+-]\d\d)$/, "$1:00") : `${iso}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`not a timestamp: ${v}`);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
export const OIDS = { INT8: 20, NUMERIC: 1700, DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 } as const;
export const PARSERS: Record<number, (v: string) => unknown> = {
  [OIDS.INT8]: Number,
  [OIDS.NUMERIC]: Number,
  [OIDS.DATE]: (v) => v,
  [OIDS.TIMESTAMP]: utcText,
  [OIDS.TIMESTAMPTZ]: utcText,
};
const builtinTypes: { getTypeParser(oid: number, format?: string): (v: string) => unknown } = pg.types;
const pgTypes = {
  getTypeParser: (oid: number, format?: string): ((v: string) => unknown) =>
    PARSERS[oid] ?? builtinTypes.getTypeParser(oid, format),
};

const LOCK = "SELECT pg_advisory_xact_lock(hashtext($1))";

function sqlOn(
  q: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>,
  exec: (text: string) => Promise<unknown>,
): Sql {
  return {
    all: async <T>(text: string, params?: unknown[]) => (await q(text, params)).rows as T[],
    one: async <T>(text: string, params?: unknown[]) => (await q(text, params)).rows[0] as T | undefined,
    run: async (text: string, params?: unknown[]) => (await q(text, params)).rowCount ?? 0,
    exec: async (text: string) => {
      await exec(text);
    },
  };
}

function poolDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, types: pgTypes, options: "-c TimeZone=UTC", max: 8 });
  pool.on("error", (e) => log.error(`an idle Postgres connection was lost; the pool replaces it: ${e.message}`));
  const base = sqlOn(
    (text, params) => pool.query(text, params),
    (text) => pool.query(text),
  );
  return {
    ...base,
    tx: async (fn, lock) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (lock !== undefined) await client.query(LOCK, [lock]);
        const out = await fn(
          sqlOn(
            (text, params) => client.query(text, params),
            (text) => client.query(text),
          ),
        );
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

const registered = new Map<string, () => Db>();
export function registerDb(key: string, make: () => Db): void {
  registered.set(key, make);
}

const pools = new Map<string, Db>();
export function openDb(url: string): Db {
  const test = registered.get(url);
  if (test) return test();
  let db = pools.get(url);
  if (!db) pools.set(url, (db = poolDb(url)));
  return db;
}

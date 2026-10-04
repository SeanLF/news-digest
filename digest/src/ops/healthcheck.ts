// healthchecks.io, the off-box dead-man's switch (newsroom/src/healthcheck.py): it alerts when the
// daily success ping does not arrive, which covers what no in-process check can see (the box, the
// worker or Temporal down). Unset HEALTHCHECK_PING_URL makes every call a no-op; no call ever throws.
import { log } from "../log.js";

export const PING_ENV = "HEALTHCHECK_PING_URL";
const TIMEOUT_MS = 10_000;
const MAX_LOG_BYTES = 1000;
// healthchecks.io records at most 5 pings a minute per check and silently drops the rest (200 "OK (rate
// limited)"). /log lines may use 3 of them; a minute holds at most two of start, success and fail.
const WINDOW_MS = 60_000;
const MAX_LOGS_PER_WINDOW = 3;

export type PingEvent = "start" | "fail";
export interface Healthcheck {
  // `note` is posted as the ping's body, which healthchecks.io shows beside the event.
  ping(event?: PingEvent, note?: string): Promise<void>;
  // /log records an event without changing up/down state: a stage boundary seen from off-box while
  // the run is still going. Throttled per instance, so a process keeps one instance per check.
  log(message: string): Promise<void>;
}

export function healthcheck(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Healthcheck {
  const logged: number[] = []; // when each /log line in the current window went out
  let unsent = 0; // /log lines dropped since the last one sent
  async function post(event: PingEvent | "log" | undefined, body?: string): Promise<void> {
    const base = env[PING_ENV];
    if (!base) return;
    const url = base.replace(/\/+$/, "") + (event ? `/${event}` : "");
    const name = event === "log" ? "log" : (event ?? "success");
    if (!url.startsWith("https://")) {
      log.warn(`${PING_ENV} is not https -- skipping ${name} ping`);
      return;
    }
    try {
      const res = await fetchImpl(url, {
        method: body === undefined ? "GET" : "POST",
        headers: { "User-Agent": "news-digest-healthcheck/1" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(body !== undefined ? { body } : {}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const answer = (await res.text()).trim();
      if (answer !== "OK") throw new Error(`not recorded: ${answer}`);
    } catch (e) {
      log.warn(`healthcheck ${name} ping failed (non-fatal): ${String(e)}`);
    }
  }
  return {
    ping: (event, note) => post(event, note === undefined ? undefined : truncateUtf8(note, MAX_LOG_BYTES)),
    log: (message) => {
      while (logged.length > 0 && logged[0]! <= now() - WINDOW_MS) logged.shift();
      if (logged.length >= MAX_LOGS_PER_WINDOW) {
        unsent++;
        return Promise.resolve();
      }
      const prefix = unsent > 0 ? `(${unsent} earlier line${unsent === 1 ? "" : "s"} not sent) ` : "";
      unsent = 0;
      logged.push(now());
      return post("log", truncateUtf8(prefix + message, MAX_LOG_BYTES));
    },
  };
}

// The line each finished model call posts to /log, as orchestrate.py posts one per stage.
export function stageDoneLine(row: { stage: string; story?: unknown; durationMs: number; costUsd: number }): string {
  const branch = typeof row.story === "number" ? ` s${String(row.story).padStart(2, "0")}` : "";
  return `${row.stage}${branch} done ${Math.floor(row.durationMs / 1000)}s $${row.costUsd.toFixed(4)}`;
}

// At most `max` bytes of UTF-8, never splitting a character.
function truncateUtf8(s: string, max: number): string {
  const bytes = Buffer.from(s, "utf8");
  if (bytes.length <= max) return s;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, max)).replace(/�$/, "");
}

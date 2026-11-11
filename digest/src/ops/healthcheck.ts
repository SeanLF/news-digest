import { log } from "../log.js";

export const PING_ENV = "HEALTHCHECK_PING_URL";
const TIMEOUT_MS = 10_000;
const MAX_LOG_BYTES = 1000;
const WINDOW_MS = 60_000;
const MAX_LOGS_PER_WINDOW = 3;

export type PingEvent = "start" | "fail";
export interface Healthcheck {
  ping(event?: PingEvent, note?: string): Promise<void>;
  log(message: string): Promise<void>;
}

export function healthcheck(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Healthcheck {
  const logged: number[] = [];
  let unsent = 0;
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

function truncateUtf8(s: string, max: number): string {
  const bytes = Buffer.from(s, "utf8");
  if (bytes.length <= max) return s;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, max)).replace(/�$/, "");
}

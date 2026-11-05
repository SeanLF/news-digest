import { createDecoder, type DecodeResult } from "gnews-decoder";
import { log } from "../log.js";
import type { GnewsDecode, LinkDecoder } from "./index.js";

export interface LinkDecoderDeps {
  decode: (url: string, opts: { signal?: AbortSignal; timeoutMs: number }) => Promise<DecodeResult>;
  timeoutMs: number;
  delayMs: number;
  deadlineMs: number;
  lockWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  heartbeat?: () => void;
  signal?: () => AbortSignal | undefined;
}

const LOCK_WAIT_MS = 60_000;
const LOCK_POLL_MS = 5_000;
const token = (url: string): string => /\/articles\/([^?/]+)/.exec(url)?.[1] ?? url;
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function linkDecoder(deps: LinkDecoderDeps): LinkDecoder {
  const now = deps.now ?? (() => performance.now());
  const sleep = deps.sleep ?? pause;
  const heartbeat = deps.heartbeat ?? (() => undefined);
  const signal = deps.signal ?? (() => undefined);
  let held: Promise<void> | undefined;

  async function pass(urls: string[]): Promise<GnewsDecode> {
    const decoded: Record<string, string> = {};
    const tried = new Map<string, string | null>();
    let attempted = 0;
    let outcome = "completed";
    const end = now() + deps.deadlineMs;
    for (const url of urls) {
      heartbeat();
      if (signal()?.aborted) {
        outcome = "cancelled";
        break;
      }
      const key = token(url);
      if (!tried.has(key)) {
        if (attempted > 0 && deps.delayMs > 0) {
          await sleep(deps.delayMs);
          if (signal()?.aborted) {
            outcome = "cancelled";
            break;
          }
        }
        if (now() > end) {
          outcome = "deadline";
          break;
        }
        const s = signal();
        const result = await deps
          .decode(url, s ? { signal: s, timeoutMs: deps.timeoutMs } : { timeoutMs: deps.timeoutMs })
          .catch((e: unknown): DecodeResult => {
            log.warn({ stage: "gnews", warning: "decoder threw", error: String(e) });
            return { ok: false, reason: "parse", message: String(e) };
          });
        if (!result.ok && result.reason === "not_google_news") {
          tried.set(key, null);
          continue;
        }
        attempted++;
        if (!result.ok && result.reason === "rate_limited") {
          outcome = "rate_limited";
          break;
        }
        if (!result.ok && result.reason === "aborted") {
          outcome = "cancelled";
          break;
        }
        tried.set(key, result.ok ? result.url : null);
      }
      const to = tried.get(key);
      if (to) decoded[url] = to;
    }
    return { links: urls.length, decoded, attempted, outcome };
  }

  return {
    async decodeLinks(urls: string[]): Promise<GnewsDecode> {
      const giveUp = now() + (deps.lockWaitMs ?? LOCK_WAIT_MS);
      for (let holder = held; holder; holder = held) {
        const spent = { links: urls.length, decoded: {}, attempted: 0 };
        if (signal()?.aborted) return { ...spent, outcome: "cancelled" };
        if (now() >= giveUp) return { ...spent, outcome: "busy" };
        heartbeat();
        await Promise.race([holder, sleep(Math.min(LOCK_POLL_MS, Math.max(0, giveUp - now())))]);
      }
      let release!: () => void;
      held = new Promise<void>((r) => (release = r));
      try {
        return await pass(urls);
      } finally {
        held = undefined;
        release();
      }
    },
  };
}

export function linkDecoderFromEnv(
  env: NodeJS.ProcessEnv,
  hooks: Pick<LinkDecoderDeps, "heartbeat" | "signal"> = {},
): LinkDecoder {
  const seconds = (name: string, fallback: number, min: "zero" | "positive") => {
    const v = Number(env[name] ?? fallback);
    if (!Number.isFinite(v) || v < 0 || (min === "positive" && v === 0))
      throw new Error(`${name} must be a ${min === "positive" ? "positive " : ""}number of seconds, got ${env[name]}`);
    return v * 1000;
  };
  const decoder = createDecoder();
  return linkDecoder({
    decode: (url, opts) => decoder.decode(url, opts),
    timeoutMs: seconds("GNEWS_RESOLVE_TIMEOUT_S", 15, "positive"),
    delayMs: seconds("GNEWS_RESOLVE_DELAY_S", 2, "zero"),
    deadlineMs: seconds("GNEWS_RESOLVE_DEADLINE_S", 120, "zero"),
    ...hooks,
  });
}

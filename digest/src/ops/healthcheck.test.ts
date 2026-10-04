import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../log.js";
import { healthcheck, stageDoneLine } from "./healthcheck.js";

type Seen = { url: string; method: string; body: string | undefined; ua: string | null; signal: boolean };
function fakeFetch(outcome: "ok" | "throw" | "500" | "rate-limited" = "ok") {
  const seen: Seen[] = [];
  const f = ((url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? "GET", body: typeof init.body === "string" ? init.body : undefined, ua: new Headers(init.headers).get("User-Agent"), signal: init.signal instanceof AbortSignal });
    if (outcome === "throw") return Promise.reject(new TypeError("fetch failed"));
    // hc-ping.com answers a ping it drops with 200 and this body, so a status check alone reads it as recorded.
    if (outcome === "rate-limited") return Promise.resolve(new Response("OK (rate limited)", { status: 200 }));
    return Promise.resolve(new Response("OK", { status: outcome === "ok" ? 200 : 500 }));
  }) as unknown as typeof fetch;
  return { seen, f };
}
const PING_URL = "https://hc-ping.com/uuid-1/";
afterEach(() => {
  vi.restoreAllMocks();
});

describe("stageDoneLine", () => {
  it("says what orchestrate.py's per-stage /log line says, naming a WRITE branch as its sNN", () => {
    expect(stageDoneLine({ stage: "select", durationMs: 61_999, costUsd: 0.51234 })).toBe("select done 61s $0.5123");
    expect(stageDoneLine({ stage: "write", story: 3, durationMs: 41_000, costUsd: 0.07 })).toBe("write s03 done 41s $0.0700");
  });
});

describe("healthcheck", () => {
  it("pings success, start and fail at the configured URL, with a timeout", async () => {
    const { seen, f } = fakeFetch();
    const hc = healthcheck({ HEALTHCHECK_PING_URL: PING_URL }, f);
    await hc.ping();
    await hc.ping("start");
    await hc.ping("fail");
    expect(seen.map((s) => [s.method, s.url])).toEqual([
      ["GET", "https://hc-ping.com/uuid-1"],
      ["GET", "https://hc-ping.com/uuid-1/start"],
      ["GET", "https://hc-ping.com/uuid-1/fail"],
    ]);
    expect(seen.every((s) => s.signal && s.ua === "news-digest-healthcheck/1")).toBe(true);
  });
  it("a ping can carry a note, which healthchecks.io shows beside the event", async () => {
    const { seen, f } = fakeFetch();
    await healthcheck({ HEALTHCHECK_PING_URL: PING_URL }, f).ping(undefined, "not sent: rejected by the operator");
    expect(seen).toMatchObject([{ method: "POST", url: "https://hc-ping.com/uuid-1", body: "not sent: rejected by the operator" }]);
  });
  it("posts a /log message, capped at 1000 bytes", async () => {
    const { seen, f } = fakeFetch();
    await healthcheck({ HEALTHCHECK_PING_URL: PING_URL }, f).log(`write s03 done 41s $0.0712 ${"x".repeat(2000)}`);
    expect(seen[0]).toMatchObject({ method: "POST", url: "https://hc-ping.com/uuid-1/log" });
    expect(Buffer.byteLength(seen[0]!.body!)).toBe(1000);
    expect(seen[0]!.body!.startsWith("write s03 done 41s $0.0712")).toBe(true);
  });
  it("is a no-op when unconfigured, and refuses a cleartext URL, which would leak its token", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const { seen, f } = fakeFetch();
    await healthcheck({}, f).ping();
    await healthcheck({ HEALTHCHECK_PING_URL: "http://hc-ping.com/uuid-1" }, f).ping("start");
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledWith("HEALTHCHECK_PING_URL is not https -- skipping start ping");
  });
  it("never throws: a network error or an error status is a warning", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await expect(healthcheck({ HEALTHCHECK_PING_URL: PING_URL }, fakeFetch("throw").f).ping()).resolves.toBeUndefined();
    await expect(healthcheck({ HEALTHCHECK_PING_URL: PING_URL }, fakeFetch("500").f).log("m")).resolves.toBeUndefined();
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      "healthcheck success ping failed (non-fatal): TypeError: fetch failed",
      "healthcheck log ping failed (non-fatal): Error: HTTP 500",
    ]);
  });
  it("a 200 that healthchecks.io did not record (rate limited) is a warning, not a success", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await healthcheck({ HEALTHCHECK_PING_URL: PING_URL }, fakeFetch("rate-limited").f).ping();
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(["healthcheck success ping failed (non-fatal): Error: not recorded: OK (rate limited)"]);
  });
  // healthchecks.io records at most 5 pings a minute per check and drops the rest: run 316's success
  // ping went 6 s after a burst of stage /log lines and was dropped, and the check paged as down.
  it("sends at most 3 /log lines a minute, so the start, success and fail pings always fit under the limit", async () => {
    let t = 0;
    const { seen, f } = fakeFetch();
    const hc = healthcheck({ HEALTHCHECK_PING_URL: PING_URL }, f, () => t);
    for (let i = 1; i <= 6; i++) {
      await hc.log(`line ${i}`);
      t += 5_000;
    }
    await hc.ping();
    expect(seen.map((s) => s.body ?? s.url)).toEqual(["line 1", "line 2", "line 3", "https://hc-ping.com/uuid-1"]);
    t = 70_001; // lines 1-3 have left the window; the success ping has not
    await hc.log("line 7");
    expect(seen.at(-1)?.body).toBe("(3 earlier lines not sent) line 7");
  });
});

export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now: number): boolean {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
    const w = this.windows.get(key) ?? { start: now, count: 0 };
    if (w.count >= this.max) return false;
    w.count++;
    this.windows.set(key, w);
    return true;
  }
}

export function clientKey(forwardedFor: string | undefined | null): string {
  const hop = forwardedFor?.split(",").at(-1)?.trim();
  return hop || "direct";
}

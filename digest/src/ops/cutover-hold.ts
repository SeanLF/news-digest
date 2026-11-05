export const CUTOVER_HOLD = "CUTOVER_HOLD";
export const HOLD_ALWAYS_ENV = "HOLD_ALWAYS_THROUGH";
export const isCutoverHold = (line: string): boolean => line.startsWith(`${CUTOVER_HOLD}:`);

export function holdAlwaysInvalid(env: Record<string, string | undefined>): string | null {
  const v = env[HOLD_ALWAYS_ENV]?.trim();
  if (!v) return null;
  const t = new Date(`${v}T00:00:00Z`);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(t.getTime()) && t.toISOString().startsWith(v);
  return valid ? null : `${HOLD_ALWAYS_ENV}='${v}' is not a YYYY-MM-DD date`;
}

export function cutoverHold(env: Record<string, string | undefined>, runDate: string): string | null {
  const through = env[HOLD_ALWAYS_ENV]?.trim();
  if (!through) return null;
  const invalid = holdAlwaysInvalid(env);
  if (invalid) return `${CUTOVER_HOLD}: ${invalid}, so every run holds until it is fixed or removed`;
  return runDate <= through
    ? `${CUTOVER_HOLD}: every run through ${through} holds for the cut-over (${HOLD_ALWAYS_ENV}); no check failed`
    : null;
}

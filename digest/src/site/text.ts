export const SEARCH_LIMIT = 50;
export function sanitizeQuery(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  return Array.from(t.replaceAll("\0", "")).slice(0, 200).join("");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

const inRange = (p: string, max: number): boolean => /^\d{1,3}$/.test(p) && Number(p) >= 1 && Number(p) <= max;
export function isValidDate(s: string): boolean {
  const segs = s.split("-");
  if (segs.length !== 3) return false;
  const [y, m, d] = segs as [string, string, string];
  return /^\d{4}$/.test(y) && inRange(m, 12) && inRange(d, 31);
}

function parts(date: string): [number, number, number] | undefined {
  const p = date.split("-");
  if (p.length !== 3) return undefined;
  const [y, m, d] = p.map(Number) as [number, number, number];
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d)) return undefined;
  return [Number.isInteger(y) ? y : 2026, m, d];
}

export function formatDate(date: string): string {
  const p = parts(date);
  if (!p) return date;
  const [y, m, d] = p;
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

export function formatMonthYear(ym: string): string {
  const [y, m] = ym.split("-");
  const n = Number(m);
  return y !== undefined && Number.isInteger(n) && n >= 1 && n <= 12 ? `${MONTHS[n - 1]} ${y}` : ym;
}

export function formatDayMonthYear(date: string): string {
  const p = parts(date);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]!.slice(0, 3)} ${date.split("-")[0]}` : date;
}

export function formatDayMonth(date: string): string {
  const p = parts(date);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]!.slice(0, 3)}` : date;
}

export const thousands = (n: number): string => n.toLocaleString("en-US");

export function brandHtml(name: string): string {
  const t = name.trim();
  const i = t.search(/\s\S*$/);
  return i < 0 ? `<em>${escapeHtml(t)}</em>` : `${escapeHtml(t.slice(0, i))} <em>${escapeHtml(t.slice(i + 1))}</em>`;
}

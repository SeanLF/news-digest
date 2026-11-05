import { decodeHTML } from "entities";

export function stripHtml(text: string): string {
  return decodeHTML(text.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

export const truncate = (text: string, n: number): string => Array.from(text).slice(0, n).join("");

export const isSafeUrl = (url: string): boolean => url.startsWith("http://") || url.startsWith("https://");

export function canonicalUrl(url: string): string {
  const s = url.trim();
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(s);
  if (!m) return s;
  const [, scheme, host, path, query] = m;
  return `${scheme!.toLowerCase()}://${host!.toLowerCase()}${path!.replace(/\/+$/, "")}${query ?? ""}`;
}

export const estimateTokens = (text: string): number => Math.floor(Array.from(text).length / 4);

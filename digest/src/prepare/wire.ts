export const WIRE_AGENCIES: ReadonlySet<string> = new Set([
  "reuters",
  "afp",
  "agence france-presse",
  "associated press",
  "ap",
  "dpa",
  "deutsche presse-agentur",
  "pa media",
  "press association",
  "efe",
  "agencia efe",
  "ansa",
  "bloomberg",
  "xinhua",
  "pti",
  "press trust of india",
  "ians",
  "anadolu agency",
  "kyodo",
  "yonhap",
  "tass",
  "upi",
  "united press international",
]);

export function wireAgency(value: string | null | undefined): string | null {
  if (!value) return null;
  let name = value
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/^[.,;:\-–—]+|[.,;:\-–—]+$/g, "")
    .toLowerCase();
  if (name.startsWith("the ")) name = name.slice(4);
  return WIRE_AGENCIES.has(name) ? name : null;
}

const DATELINE =
  /^\s*(?:By\s+[^,]{0,60}?)?(?:[A-Z][A-Za-z.\-']*(?:[ ,][A-Z][A-Za-z.\-']*){0,4}\s*,?\s*)?(?:[\p{L}\p{N}_]+\s+\d{1,2}\s*)?\(\s*([A-Za-z][A-Za-z -]{1,28}?)\s*\)\s*[-–—:]/u;

export function wireFromDateline(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = DATELINE.exec(text);
  return m ? wireAgency(m[1]) : null;
}

const BODY_DATELINE =
  /(?:\b[A-Z][A-Z.'/ -]{2,40}?(?:,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)?,\s*|\b)[A-Z][a-z]{2,9}\.?\s+\d{1,2}\s*\(\s*([A-Za-z][A-Za-z -]{1,28}?)\s*\)\s*[-–—]\s*["'‘“]?[\p{Lu}\d]/u;

export function wireFromFullText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = BODY_DATELINE.exec(text.slice(0, 600));
  return m ? wireAgency(m[1]) : null;
}

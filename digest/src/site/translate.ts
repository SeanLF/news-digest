const DEFAULT_LANG = "fr";
const MAX_LANG_TAG = 35;
const MAX_PATH = 128;

const isLangTag = (t: string): boolean => t.length > 0 && t.length <= MAX_LANG_TAG && /^[A-Za-z0-9-]+$/.test(t);

export function validQueryLang(tag: string | undefined): string | undefined {
  if (tag === undefined) return undefined;
  return isLangTag(tag) && (tag.split("-")[0] ?? "").toLowerCase() !== "en" ? tag : undefined;
}

export function pickTargetLang(acceptLanguage: string | undefined): string {
  for (const item of (acceptLanguage ?? "").split(",")) {
    const tag = (item.split(";")[0] ?? "").trim();
    if ((tag.split("-")[0] ?? "").toLowerCase() === "en" || !isLangTag(tag)) continue;
    return tag;
  }
  return DEFAULT_LANG;
}

export const validTranslatePath = (p: string | undefined): string | undefined =>
  p !== undefined && p.startsWith("/") && !p.startsWith("//") && p.length <= MAX_PATH && /^[A-Za-z0-9/_-]+$/.test(p)
    ? p
    : undefined;

export const proxyHost = (domain: string): string =>
  `${domain.replaceAll("-", "--").replaceAll(".", "-")}.translate.goog`;

export function proxyTarget(
  domain: string | undefined,
  path: string,
  queryLang: string | undefined,
  acceptLanguage: string | undefined,
): string {
  if (!domain) return path;
  const lang = validQueryLang(queryLang) ?? pickTargetLang(acceptLanguage);
  return `https://${proxyHost(domain)}${path}?_x_tr_sl=en&_x_tr_tl=${lang}&_x_tr_hl=${lang}`;
}

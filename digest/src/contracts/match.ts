export function normHeadline(headline: string): string {
  let t = (headline ?? "").normalize("NFKC");
  for (const [f, p] of [
    ["’", "'"],
    ["‘", "'"],
    ["“", '"'],
    ["”", '"'],
    ["—", "-"],
    ["–", "-"],
  ] as const)
    t = t.replaceAll(f, p);
  return t
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "")
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replaceAll("ς", "σ");
}

export const itemIds = (sources: { article_id: string }[]): Set<string> => new Set(sources.map((s) => s.article_id));

export function resultMatches(
  result: { article_ids?: string[]; headline?: string },
  ids: Set<string>,
  norm: string,
): boolean {
  const rids = result.article_ids ?? [];
  const rset = new Set(rids);
  if (rset.size && ids.size && rset.size === ids.size && [...rset].every((r) => ids.has(r))) return true;
  return result.headline !== undefined && normHeadline(result.headline) === norm;
}

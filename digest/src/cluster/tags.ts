import { z } from "zod";

export interface Tag {
  entities: string[];
  keywords: string[];
  primary_event: string;
}

export const TAG_BAG_WEIGHTS = { entities: 3, keywords: 1, primary_event: 2 } as const;

export const TOKEN_RE = /[\p{L}\p{N}_]{2,}/u;

export const ExtractItemSchema = z.object({
  article_id: z.string(),
  entities: z.array(z.union([z.string(), z.number()])).nullish(),
  keywords: z.array(z.union([z.string(), z.number()])).nullish(),
  primary_event: z.union([z.string(), z.number()]).nullish(),
});
export const ExtractItemsSchema = z.object({ items: z.array(ExtractItemSchema) });

export function extractItemsJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ExtractItemsSchema, { target: "draft-07" });
}

const strs = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap((x: unknown) => (typeof x === "string" ? [x] : typeof x === "number" ? [String(x)] : []))
    : [];

export function coerceTag(item: object): Tag {
  const o = item as Record<string, unknown>;
  const pe = o["primary_event"];
  return {
    entities: strs(o["entities"]),
    keywords: strs(o["keywords"]),
    primary_event: typeof pe === "string" ? pe : typeof pe === "number" ? String(pe) : "",
  };
}

export function tagBag(tag: Tag | undefined): string {
  if (!tag) return "";
  const ents = tag.entities.map((e) => e.toLowerCase());
  const kws = tag.keywords.map((k) => k.toLowerCase());
  const pe = tag.primary_event.toLowerCase().trim();
  const parts = [
    ...Array<string[]>(TAG_BAG_WEIGHTS.entities).fill(ents).flat(),
    ...Array<string[]>(TAG_BAG_WEIGHTS.keywords).fill(kws).flat(),
    ...(pe ? Array<string>(TAG_BAG_WEIGHTS.primary_event).fill(pe) : []),
  ];
  return parts.filter((p) => p.trim()).join(" ");
}

export const usable = (tag: Tag | undefined): boolean => TOKEN_RE.test(tagBag(tag));

export function itemsForBatch<T extends { article_id: string }>(items: T[], batch: string[]): T[] {
  const wanted = new Set(batch);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (wanted.has(it.article_id) && !seen.has(it.article_id)) {
      seen.add(it.article_id);
      out.push(it);
    }
  }
  return out;
}

import { z } from "zod";
import { log } from "../log.js";
import { wireFromFullText } from "../prepare/wire.js";
import { AGENCY_LABELS, titleCase, type Selections, type Source, type Story, type ThreadContext } from "./common.js";

// One article_index.json entry, as prepare writes it; wire_agency predates some archived indexes.
const IndexEntry = z.object({ name: z.string(), url: z.string(), bias: z.string(), source_id: z.string(), original_title: z.string(), wire: z.boolean().optional(), wire_agency: z.string().nullable().optional() });

// digest._repost_key: a title normalised for verbatim-repost matching, less the " - <Source>"
// suffix Google-News-fetched feeds append, matched against the source's own name only.
export function repostKey(title: string, sourceName: string): string {
  const suffix = ` - ${sourceName}`;
  let t = title;
  if (sourceName && t.toLowerCase().endsWith(suffix.toLowerCase())) t = t.slice(0, -suffix.length);
  return t.toLowerCase().replaceAll(/[^a-z0-9 ]/g, " ").replaceAll(/\s+/g, " ").trim();
}

// digest.resolve_article_ids: each {article_id} becomes its outlet, link and leaning from the run's
// article index; an id the index lacks is dropped, and so is a story left with no source.
export function resolveArticleIds(selections: Selections, index: Record<string, unknown>, fulltext: Record<string, { text?: string }> = {}): Selections {
  let unresolved = 0;
  const lookup = (id: string): Source | null => {
    const meta = IndexEntry.safeParse(Object.hasOwn(index, id) ? index[id] : undefined);
    if (!meta.success) return null;
    const { name, url, bias, source_id, original_title, wire, wire_agency } = meta.data;
    const fromBody = wire_agency ? null : wireFromFullText(Object.hasOwn(fulltext, id) ? fulltext[id]?.text : undefined);
    return { name, url, bias, source_id, original_title, wire: wire ?? false, wire_agency: wire_agency ?? fromBody };
  };
  const resolve = (src: Source): Source | null => {
    if (!src.article_id) return src;
    const found = lookup(src.article_id);
    if (!found) unresolved++;
    return found && { ...found, article_id: src.article_id };
  };
  const tier = (stories: Story[]) =>
    stories.flatMap((item) => {
      const sources = item.sources.map(resolve).filter((s): s is Source => s !== null);
      if (!sources.length) {
        log.warn({ stage: "render", warning: "dropped a story with no resolved sources", headline: item.headline });
        return [];
      }
      const varies = item.reporting_varies?.map(({ article_id, ...rv }) => {
        const found = article_id ? lookup(article_id) : null;
        if (!found) return rv;
        const agency = found.wire_agency?.trim().toLowerCase();
        const source = agency ? (AGENCY_LABELS[agency] ?? titleCase(agency)) : found.name;
        return source ? { ...rv, source } : rv;
      });
      return [{ ...item, sources, ...(varies ? { reporting_varies: varies } : {}) }];
    });
  const out = { ...selections, must_know: tier(selections.must_know), should_know: tier(selections.should_know) };
  if (unresolved) log.warn({ stage: "render", warning: "dropped unresolved article_id references", count: unresolved });
  return out;
}

// Google-News redirect links upgraded to the publisher URL, where the decoder found one.
export function applyDecodedLinks(selections: Selections, links: Record<string, string>): Selections {
  const decoded = (src: Source): Source => {
    const to = src.url && Object.hasOwn(links, src.url) ? links[src.url] : undefined;
    return to ? { ...src, url: to } : src;
  };
  const tier = (stories: Story[]) => stories.map((s) => ({ ...s, sources: s.sources.map(decoded) }));
  return { ...selections, must_know: tier(selections.must_know), should_know: tier(selections.should_know) };
}

// The join in digest.attach_thread_context: a story takes its cluster's thread context, unless two
// stories share the cluster, when the delta that replaces the summary would render both alike.
export function attachThreads(selections: Selections, contexts: Record<string, ThreadContext>): Selections {
  const counts = new Map<string, number>();
  for (const s of [...selections.must_know, ...selections.should_know]) if (s.cluster_id) counts.set(s.cluster_id, (counts.get(s.cluster_id) ?? 0) + 1);
  const tier = (stories: Story[]) =>
    stories.map((s) => {
      if (!s.cluster_id) return s;
      if ((counts.get(s.cluster_id) ?? 0) > 1) {
        log.error({ stage: "render", error: "cluster_id shared by several stories; thread context skipped", headline: s.headline, cluster_id: s.cluster_id });
        return s;
      }
      const ctx = Object.hasOwn(contexts, s.cluster_id) ? contexts[s.cluster_id] : undefined;
      return ctx ? { ...s, thread: ctx } : s;
    });
  return { ...selections, must_know: tier(selections.must_know), should_know: tier(selections.should_know) };
}

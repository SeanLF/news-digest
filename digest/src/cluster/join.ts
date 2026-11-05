import { agnes } from "ml-hclust";
import { tagBag, TOKEN_RE, type Tag } from "./tags.js";
import { cosine, tfidf } from "./tfidf.js";

export interface Cluster {
  story: string;
  article_ids: string[];
}

export const JOIN_THRESHOLD = 0.8;
export const STRAY_ABSORB_MAX = 2;

export function joinTags(articleIds: string[], tags: Record<string, Tag>, threshold = JOIN_THRESHOLD): Cluster[] {
  if (articleIds.length === 0) return [];
  if (articleIds.length === 1) {
    const aid = articleIds[0]!;
    return [{ story: tags[aid]?.primary_event || "cluster 1", article_ids: [aid] }];
  }
  const docs = articleIds.map((aid, i) => {
    const bag = tagBag(tags[aid]);
    return TOKEN_RE.test(bag) ? bag : `notags${i}`;
  });
  const vecs = tfidf(docs);
  const n = vecs.length;
  const dist: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = Math.max(0, 1 - cosine(vecs[i]!, vecs[j]!));
      dist[i]![j] = d;
      dist[j]![i] = d;
    }
  const tree = agnes(dist, { method: "average", isDistanceMatrix: true });
  const groups = tree
    .cut(threshold)
    .map((c) => c.indices().toSorted((a, b) => a - b))
    .toSorted((a, b) => a[0]! - b[0]!);
  const clusters: Cluster[] = groups.map((members, k) => {
    const ids = members.map((i) => articleIds[i]!);
    return { story: modalEvent(ids, tags) || `cluster ${k + 1}`, article_ids: ids };
  });
  return mergeSameStory(clusters);
}

function modalEvent(ids: string[], tags: Record<string, Tag>): string {
  const counts = new Map<string, number>();
  for (const a of ids) {
    const pe = tags[a]?.primary_event;
    if (pe) counts.set(pe, (counts.get(pe) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [pe, c] of counts)
    if (c > bestN) {
      best = pe;
      bestN = c;
    }
  return best;
}

export function mergeSameStory(clusters: Cluster[], absorbMax = STRAY_ABSORB_MAX): Cluster[] {
  const positions = new Map<string, number[]>();
  clusters.forEach((c, i) => positions.set(c.story, [...(positions.get(c.story) ?? []), i]));
  const anchorOf = new Map<string, number>();
  for (const [story, idxs] of positions)
    if (idxs.length > 1)
      anchorOf.set(
        story,
        idxs.reduce((best, i) => (clusters[i]!.article_ids.length > clusters[best]!.article_ids.length ? i : best)),
      );
  if (anchorOf.size === 0) return clusters;
  const out: Cluster[] = [];
  clusters.forEach((c, i) => {
    const anchor = anchorOf.get(c.story);
    if (anchor === undefined) out.push(c);
    else if (anchor === i) {
      const ids = [...c.article_ids];
      const seen = new Set(ids);
      for (const j of positions.get(c.story) ?? [])
        if (j !== i && clusters[j]!.article_ids.length <= absorbMax)
          for (const a of clusters[j]!.article_ids)
            if (!seen.has(a)) {
              seen.add(a);
              ids.push(a);
            }
      out.push({ story: c.story, article_ids: ids });
    } else if (c.article_ids.length > absorbMax) out.push(c);
  });
  return out;
}

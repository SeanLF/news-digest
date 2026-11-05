import { log } from "../log.js";
import { resolveArticleIds, type Selections } from "../render/render.js";
import type { ArtifactStore, Pointer } from "../store/artifacts.js";
import { DECODED_LINKS, type GnewsDecode, type GnewsPlan } from "./index.js";

export const GNEWS_HEALTH = "gnews_health.json";
const SETTLED = new Set(["completed", "no_candidates", "rate_limited", "deadline", "failed"]);
const CANARY_MIN_ATTEMPTS = 3;

export const isGnewsUrl = (url: string): boolean => url.includes("news.google.com") && url.includes("/articles/");

export function survivingLinks(selections: Selections, index: Record<string, unknown>): string[] {
  const resolved = resolveArticleIds(selections, index);
  const urls = [...resolved.must_know, ...resolved.should_know].flatMap((s) => s.sources.map((src) => src.url ?? ""));
  return [...new Set(urls.filter(isGnewsUrl))];
}

export function gnewsActivities(deps: { store: ArtifactStore; enabled: boolean }) {
  const { store } = deps;
  return {
    async planGnews(runId: number, selections: Pointer, force = false): Promise<GnewsPlan> {
      const existing = await store.find(runId, DECODED_LINKS);
      if (existing && !force) {
        const health = await store.find(runId, GNEWS_HEALTH);
        const outcome = health ? (JSON.parse(await store.get(health)) as { outcome?: unknown }).outcome : undefined;
        if (!health || SETTLED.has(String(outcome))) return { urls: [], existing };
        await store.quarantine(runId, DECODED_LINKS);
        await store.quarantine(runId, GNEWS_HEALTH);
      }
      if (!deps.enabled) return { urls: [], skip: "disabled" };
      const indexPtr = await store.find(runId, "article_index.json");
      const index = indexPtr ? (JSON.parse(await store.get(indexPtr)) as Record<string, unknown>) : {};
      const urls = survivingLinks(JSON.parse(await store.get(selections)) as Selections, index);
      return urls.length ? { urls } : { urls, skip: "no_candidates" };
    },
    async storeGnews(runId: number, result: GnewsDecode, force = false): Promise<Pointer> {
      const decoded = Object.fromEntries(Object.entries(result.decoded).filter(([, to]) => to.startsWith("http")));
      const upgraded = Object.keys(decoded).length;
      if (result.links && !upgraded && result.outcome !== "rate_limited" && result.attempted >= CANARY_MIN_ATTEMPTS) {
        log.warn({
          stage: "gnews",
          warning:
            "upgraded 0 shown links; the decoder contract has probably moved again, check gnews-decoder for an update (npm run test:live there)",
          links: result.links,
          attempted: result.attempted,
        });
      }
      const write = (name: string, text: string) =>
        force ? store.replace(runId, name, text) : store.put(runId, name, text);
      await write(
        GNEWS_HEALTH,
        JSON.stringify({
          links: result.links,
          decoded: upgraded,
          attempted: result.attempted,
          outcome: result.outcome,
        }),
      );
      return write(DECODED_LINKS, JSON.stringify(decoded, null, 2));
    },
  };
}

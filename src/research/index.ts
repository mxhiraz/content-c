import { researchViaWebSearch } from "./webSearch.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { getSeenIds, markSeen } from "./seenStore.js";
import type { FeedKind } from "./feeds.js";
import type { Article } from "../types.js";

export interface ResearchOpts {
  limit?: number;
  storyIndex?: number;
  skipSeen?: boolean;
  feed?: FeedKind;
}

export async function researchTopArticles(opts: ResearchOpts = {}): Promise<Article[]> {
  const limit = opts.limit ?? config.pipeline.maxArticlesPerRun;
  const skipSeen = opts.skipSeen ?? true;
  const feed = opts.feed ?? "viral";
  const all = await researchViaWebSearch(Math.max(limit + 5, 8), feed);

  let pool = all;
  if (skipSeen) {
    const seen = await getSeenIds(30);
    pool = all.filter((a) => !seen.has(a.id));
    if (pool.length < limit && all.length > pool.length) {
      log.warn("research", `${all.length - pool.length} articles skipped as seen; ${pool.length} fresh available`);
    }
    if (pool.length === 0 && all.length > 0) {
      log.warn("research", "all top stories were already seen; recycling oldest from cache");
      pool = all;
    }
  }

  if (typeof opts.storyIndex === "number") {
    const i = Math.max(0, Math.min(pool.length - 1, opts.storyIndex));
    log.info("research", `pinned story_index=${i} of ${pool.length}`);
    return pool.slice(i, i + 1);
  }

  return pool.slice(0, limit);
}

export async function recordRendered(article: Article): Promise<void> {
  await markSeen({ id: article.id, url: article.url, title: article.title });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const top = await researchTopArticles();
  for (const a of top) {
    console.log(`[${a.topicScore.toFixed(2)}] (${a.source}) ${a.title}\n  ${a.url}\n  ${a.body.slice(0, 160)}…\n`);
  }
}

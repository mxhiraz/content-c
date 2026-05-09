import { carouselQueue } from "./queue.js";
import { getSeenIds, markSeen } from "../research/seenStore.js";
import { log } from "../log.js";
import { createHash } from "node:crypto";

// Curated newsletter feeds — Tier-1 editorial picks. Add/remove via NEWSLETTER_FEEDS env.
const DEFAULT_FEEDS = [
  "https://www.bensbites.com/rss",
  "https://alphasignal.ai/rss",
  "https://tldr.tech/ai/rss",
  "https://huggingface.co/blog/feed.xml",
];

const FEEDS = (process.env.NEWSLETTER_FEEDS ?? DEFAULT_FEEDS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const MAX_PER_RUN = Number.parseInt(process.env.NEWSLETTER_MAX_PER_RUN ?? "1", 10);

interface FeedItem {
  url: string;
  title: string;
  pubDate: number;
  source: string;
}

async function fetchFeed(feedUrl: string): Promise<FeedItem[]> {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": "Mozilla/5.0 ai-carousel-factory" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      log.warn("newsletter", `${feedUrl} HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return parseFeed(xml, new URL(feedUrl).hostname);
  } catch (e) {
    log.warn("newsletter", `${feedUrl} failed: ${(e as Error).message}`);
    return [];
  }
}

function parseFeed(xml: string, host: string): FeedItem[] {
  const items: FeedItem[] = [];
  // RSS <item> blocks
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1] ?? "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ??
      block.match(/<link[^>]+href=["']([^"']+)["']/)?.[1]?.trim() ?? "").trim();
    const title = decodeXml((block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? "").trim());
    const pubStr = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    const pubDate = Date.parse(pubStr) || Date.now();
    if (link && title) items.push({ url: link, title, pubDate, source: host });
  }
  // Atom <entry> fallback
  if (!items.length) {
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const block = m[1] ?? "";
      const link = block.match(/<link[^>]+href=["']([^"']+)["']/)?.[1]?.trim() ?? "";
      const title = decodeXml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "").trim());
      const pubStr = block.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() ?? "";
      const pubDate = Date.parse(pubStr) || Date.now();
      if (link && title) items.push({ url: link, title, pubDate, source: host });
    }
  }
  return items;
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * Poll all newsletter feeds, dedup vs seen-store, enqueue top N truly-new items.
 * Newsletters are pre-curated by humans → no extra "hotness" filter needed.
 */
export async function pollNewsletters(): Promise<{ enqueued: number; checked: number }> {
  const all: FeedItem[] = [];
  for (const f of FEEDS) {
    const items = await fetchFeed(f);
    all.push(...items);
  }
  log.info("newsletter", `${all.length} items across ${FEEDS.length} feeds`);

  // Filter: last 24h only
  const cutoff = Date.now() - 24 * 60 * 60_000;
  const recent = all.filter((i) => i.pubDate >= cutoff);

  // Dedup against seen-store
  const seen = await getSeenIds(30);
  const fresh = recent.filter((i) => {
    const id = createHash("sha1").update(i.url).digest("hex").slice(0, 16);
    return !seen.has(id);
  });

  // Sort newest-first, take top N
  fresh.sort((a, b) => b.pubDate - a.pubDate);
  const picked = fresh.slice(0, MAX_PER_RUN);
  if (!picked.length) return { enqueued: 0, checked: all.length };

  for (const item of picked) {
    await carouselQueue.add("render", {
      url: item.url,
      title: item.title,
      source: item.source,
      feed: "viral",
    } as Parameters<typeof carouselQueue.add>[1]);
    await markSeen({ id: createHash("sha1").update(item.url).digest("hex").slice(0, 16), url: item.url, title: item.title });
    log.ok("newsletter", `queued: ${item.title.slice(0, 80)}`);
  }
  return { enqueued: picked.length, checked: all.length };
}

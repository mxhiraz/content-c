// Editorial AI-news source pre-fetcher.
//
// Why: Claude's web_search relies on Google's index, which lags behind. Viral AI moments
// break on these editorial outlets hours before Google sees them. Pre-fetching their RSS
// feeds + passing recent items as CANDIDATES gives Claude a real-time signal to pick from.

import { log } from "../log.js";

export interface EditorialItem {
  title: string;
  url: string;
  source: string;
  pubDate: number; // unix ms
  description?: string;
}

// Broadened May 2026 per client: feed felt AI-heavy + Anthropic/OpenAI-centric.
// Cover politics, business, world events, culture, tech-beyond-AI, science, sports
// as well as AI. AI is one beat among many.
// Many editorial outlets killed direct RSS or now require auth (Reuters 2020+, AP 401,
// Politico 403, Semafor 404). Use Google News RSS aliases (`news.google.com/rss/search?q=site:X`)
// as a stable fallback — they index the publisher's content + serve clean RSS forever.
const gnews = (siteQuery: string): string =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(siteQuery)}&hl=en-US&gl=US&ceid=US:en`;

export const EDITORIAL_FEEDS: { source: string; rss: string }[] = [
  // World / international (direct RSS where available, gnews alias otherwise)
  { source: "bbc-world", rss: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { source: "reuters-world", rss: gnews("site:reuters.com when:1d") },
  { source: "apnews-top", rss: gnews("site:apnews.com when:1d") },
  { source: "guardian-world", rss: "https://www.theguardian.com/world/rss" },
  // Politics + current affairs
  { source: "politico", rss: gnews("site:politico.com when:1d") },
  { source: "axios", rss: gnews("site:axios.com when:1d") },
  { source: "semafor", rss: gnews("site:semafor.com when:1d") },
  { source: "atlantic", rss: "https://www.theatlantic.com/feed/all/" },
  // Business / markets
  { source: "bloomberg", rss: gnews("site:bloomberg.com when:1d") },
  { source: "ft", rss: gnews("site:ft.com when:1d") },
  { source: "wsj", rss: gnews("site:wsj.com when:1d") },
  { source: "economist", rss: "https://www.economist.com/the-world-this-week/rss.xml" },
  // Tech (broad, not just AI)
  { source: "theverge", rss: "https://www.theverge.com/rss/index.xml" },
  { source: "arstechnica", rss: "https://feeds.arstechnica.com/arstechnica/index" },
  { source: "techcrunch", rss: "https://techcrunch.com/feed/" },
  { source: "wired", rss: "https://www.wired.com/feed/rss" },
  // AI-specific (kept as ONE beat among many — capped to ~1-2 stories per batch)
  { source: "venturebeat-ai", rss: "https://venturebeat.com/category/ai/feed/" },
  { source: "ai-news", rss: "https://www.artificialintelligence-news.com/feed/" },
  { source: "aimagazine", rss: gnews("site:aimagazine.com when:7d") },
  // Science + research
  { source: "nature", rss: "https://www.nature.com/nature.rss" },
  { source: "science-news", rss: "https://www.sciencenews.org/feed" },
  // Culture + sports
  { source: "variety", rss: "https://variety.com/feed/" },
  { source: "espn", rss: "https://www.espn.com/espn/rss/news" },
];

/** Fetch one RSS/Atom feed. Returns parsed items or [] on failure. */
async function fetchOne(feedUrl: string, source: string): Promise<EditorialItem[]> {
  try {
    const res = await fetch(feedUrl, {
      headers: { "user-agent": "ai-carousel-factory/1.0 (+editorial-prefetch)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn("editorial", `${feedUrl} HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    return parseFeed(xml, source);
  } catch (e) {
    log.warn("editorial", `${feedUrl} failed: ${(e as Error).message}`);
    return [];
  }
}

function parseFeed(xml: string, source: string): EditorialItem[] {
  const items: EditorialItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1] ?? "";
    const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ??
      block.match(/<link[^>]+href=["']([^"']+)["']/)?.[1]?.trim() ?? "").trim();
    const title = decodeXml((block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? "").trim());
    const desc = decodeXml((block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ?? "").trim().slice(0, 300));
    const pubStr = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    const pubDate = Date.parse(pubStr) || Date.now();
    if (link && title) items.push({ url: link, title, pubDate, source, description: desc || undefined });
  }
  if (!items.length) {
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
      const block = m[1] ?? "";
      const link = block.match(/<link[^>]+href=["']([^"']+)["']/)?.[1]?.trim() ?? "";
      const title = decodeXml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "").trim());
      const desc = decodeXml((block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "").trim().slice(0, 300));
      const pubStr = block.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() ?? "";
      const pubDate = Date.parse(pubStr) || Date.now();
      if (link && title) items.push({ url: link, title, pubDate, source, description: desc || undefined });
    }
  }
  return items;
}

function decodeXml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

/** Pull latest items from ALL editorial feeds in parallel. Filters to last `maxAgeHours`,
 *  sorts by pubDate desc, dedupes by URL. Returns top N. */
export async function fetchEditorialCandidates(opts: { limit?: number; maxAgeHours?: number } = {}): Promise<EditorialItem[]> {
  const limit = opts.limit ?? 30;
  const maxAgeMs = (opts.maxAgeHours ?? 24) * 3600_000;
  const cutoff = Date.now() - maxAgeMs;

  const t0 = Date.now();
  const batches = await Promise.all(EDITORIAL_FEEDS.map((f) => fetchOne(f.rss, f.source)));
  const all = batches.flat().filter((i) => i.pubDate >= cutoff);

  const seen = new Set<string>();
  const dedup: EditorialItem[] = [];
  for (const it of all.sort((a, b) => b.pubDate - a.pubDate)) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    dedup.push(it);
    if (dedup.length >= limit) break;
  }
  log.ok("editorial", `${batches.flat().length} items across ${EDITORIAL_FEEDS.length} feeds, ${dedup.length} fresh in last ${opts.maxAgeHours ?? 24}h (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return dedup;
}

/** Format candidates as a Markdown list block for splicing into the research prompt. */
export function formatCandidatesBlock(items: EditorialItem[]): string {
  if (!items.length) return "";
  const lines = items.map((i) => {
    const hours = Math.round((Date.now() - i.pubDate) / 3600_000);
    const desc = i.description ? ` — ${i.description.slice(0, 140)}` : "";
    return `- [${i.source}, ${hours}h ago] ${i.title}${desc}\n  ${i.url}`;
  });
  return `\n\nPRE-FETCHED EDITORIAL CANDIDATES (last 24h ONLY — these are the freshest stories from RSS, no older items):\nReal, recent stories from world news, politics, business, tech, science, culture, sports, AI. PICK ONLY FROM THIS LIST when possible. Stories older than 24h MUST be rejected. DIVERSIFY TOPICS across batches — do NOT pick 3 AI stories in a row when politics/business/culture/world stories are available.\n\n${lines.join("\n")}\n`;
}

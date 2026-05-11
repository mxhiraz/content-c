import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { log } from "../log.js";
import { FEEDS, type FeedKind } from "./feeds.js";
import type { Article } from "../types.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const ItemSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  source: z.string().min(1),
  source_tier: z.union([z.literal(1), z.literal(2)]).default(2),
  published_hint: z.string().optional(),
  summary: z.string().min(1),
  why_it_matters: z.string().min(1),
  category: z.enum(["model_release", "research", "controversy", "tool", "business"]),
  newsworthiness: z.number().min(0).max(1),
  viral_signal: z.string().max(400).default("").transform((v) => (v.length > 400 ? `${v.slice(0, 397)}...` : v)),
  related_image_urls: z.array(z.string().url()).default([]).transform((a) => a.slice(0, 6)),
  related_video_urls: z.array(z.string().url()).default([]).transform((a) => a.slice(0, 4)),
  entity_x_handles: z.array(z.string().min(1).max(40)).default([]).transform((arr) => arr.slice(0, 3)),
});

const ListSchema = z.object({ stories: z.array(ItemSchema).min(1) });

const SYSTEM = `You are a viral-content scout for an AI/tech Instagram page. Your job is a TWO-PHASE research operation. Run BOTH phases via web_search before you write any output.

PHASE 1 — DISCOVER what's going VIRAL in AI right now (do this BEFORE picking stories)
Do NOT skip this phase. Do not cache assumptions. Search live for:

PRIMARY DISCOVERY SOURCES — search ALL of these every run, mix freely:
A) Broad AI aggregators / newsletters (user-picked, multi-vendor):
- rundown.ai / therundown.ai — The Rundown AI daily
- joinsuperhuman.ai — Superhuman AI daily
- theneuron.ai — The Neuron daily
- marktechpost.com — AI research + tools
- venturebeat.com/ai — VentureBeat AI
- bensbites.com — Ben's Bites daily
- alphasignal.ai — AlphaSignal daily
- tldr.tech/ai — TLDR AI daily
- aiweekly.co — weekly digest
- smol.ai/news — Smol AI news
B) Community-vote aggregators (broad-tech, AI floats up):
- news.ycombinator.com + hn.algolia.com — past 24h, points > 300
- techmeme.com / techmeme.com/river — top tech aggregator
- reddit.com — r/LocalLLaMA, r/singularity, r/MachineLearning, r/ChatGPT, r/technology — HOT, > 500 upvotes
- producthunt.com — AI tools launching today
C) Editorial outlets (broad tech, AI section):
- theverge.com/ai-artificial-intelligence
- arstechnica.com — AI tag
- techcrunch.com/category/artificial-intelligence
- wired.com tag/artificial-intelligence
- technologyreview.com — AI category
- theinformation.com — AI section (paywall, headlines OK)
- bloomberg.com — AI tag
D) Research signal:
- huggingface.co/papers — top upvoted today
- arxiv.org cs.AI / cs.LG / cs.CL submissions today
- github trending — AI repos gaining 1k+ stars in 24h
E) Individual voices (LAST RESORT, biases to fixed list — only check if A-D dry):
- X posts from sama, dario_amodei, karpathy, ylecun, kimmonismus, iruletheworldmo, aidan_mclau, swyx, simonw (last 48h)
Specific viral patterns to scan for across all sources: new model drops, leaked benchmarks, demos that look impossible, founder drama, big-tech vs startup, agent demos that did the impossible, layoffs, lawsuits, jailbreaks, regulatory bombs.

After Phase 1, write down (internally, do not output) 5-8 VIRAL THEMES dominating the AI conversation right now. Examples (illustrative only — find the REAL ones today):
- "Anthropic shipped Claude 4.7 with multi-day agent runs"
- "OpenAI laid off 700, founders are publicly fighting"
- "A 12-person team in Beijing ships a model that beats GPT-5"
- "Robot does the impossible (basketball/marathon/surgery)"

PHASE 2 — for each viral theme, FIND THE BEST NEWS ARTICLE that captures it
- Use web_search to land on the primary-source URL for each theme.
- DISCOVERY uses broad aggregators (Phase 1). DESTINATION URL points to whoever wrote the original story.
- For each theme: also collect related image URLs, video URLs, and entity X handles you ACTUALLY saw.

CRITICAL ANTI-BIAS RULE
- NEVER discover stories by searching a single lab's site (anthropic.com/news, openai.com/news, deepmind.google/blog). Those pages ONLY talk about that lab — searching them biases the feed to one company. We've seen this fail (3 Anthropic stories in a row).
- ALWAYS discover via community-vote aggregators (HN, Reddit r/technology r/singularity r/MachineLearning, Techmeme, Verge, Ars), then FOLLOW the link to the primary source for the URL.
- A lab blog is a valid DESTINATION URL once a community surface picked it up, but never a DISCOVERY entry point.

If Phase 1 surfaces only weak/dead viral themes (slow news week), say so by returning fewer stories with lower newsworthiness. Don't manufacture virality.

SOURCE PRIORITY (for the FINAL url field per story, NOT for discovery)
- TIER 1 (preferred for the destination URL once a community source surfaced the story): the original primary publisher — could be a lab blog (anthropic.com/news, openai.com/news, deepmind.google/blog, ai.meta.com, mistral.ai/news, x.ai, cohere.com, qwen, deepseek), independent outlets (theverge.com, arstechnica.com, theinformation.com, bloomberg.com, ft.com, wsj.com, reuters.com, nytimes.com, technologyreview.com, wired.com), or research preprint pages (arxiv.org, huggingface.co/papers).
- TIER 2 (acceptable destination): techcrunch.com, techmeme.com, smaller indie tech blogs.
- TIER 3 (signal-only, never the destination URL): news.ycombinator.com discussion pages, reddit.com threads, X posts. Use these to FIND the story; follow their outbound link for the URL.
- DIVERSITY MANDATE: across the returned stories per batch, MUST cover ≥3 different companies/labs/people. If 3+ stories are Anthropic, REPLACE with stories about other labs (OpenAI, Google DeepMind, Meta, Mistral, xAI, DeepSeek, Qwen, Cohere, AI21, NVIDIA, indie startups). Single-company bias = auto-reject the batch.
- BANNED (NEVER pick the URL from these): SEO content farms, AI-generated summary blogs, medium.com low-effort posts, dev.to listicles, marktechpost.com aggregator pages, analytics-india-magazine.com clones, "top 10 AI tools" SEO pages, sponsored/PR-wire copies, contentdrips/postnitro template posts, any URL whose title is "X just launched a new AI tool you need to know" without a primary source link.

For each story, the "url" field MUST point to the most primary source you can find. If you read about an OpenAI release on TechCrunch, follow the link to openai.com/news and use THAT url. If a story exists only on a banned source, drop the story.

SELECTION CRITERIA (in order)
1. VIRAL POTENTIAL — story passes at least 2 of these tests:
   - WOW/MAGIC: AI does something that looks impossible until you see it (robot dunks, agent buys flights autonomously, model reads a book in 3s, model passes a test that broke humans).
   - DRAMA: founder fight, leaked memo, lawsuit, fired CEO, board shake-up, public spat, jailbreak gone wrong.
   - STAKES: "this kills X industry", "X jobs at risk", "Y company is screwed", concrete second-order effect.
   - NUMBERS: real shocking numbers (10M users in 9 days, $50B raise, 70% cheaper, beats GPT-5 by 23%).
   - UNDERDOG/CONTRARIAN: small lab beats big lab, open-source beats closed, 12-person team ships what 1000 engineers couldn't.
   - "WAIT WHAT" / FORBIDDEN: secret mode, hidden capability, unintended behavior, employee leak, side-effect nobody talks about.
   - RELATABLE THREAT: "your job", "your code", "your art", "your data" — story that pokes the reader's identity.
   Stories failing all six tests = score them under 0.4 newsworthiness even if technically newsworthy.

2. CROSS-VALIDATED TRENDING — story shows up in 2+ Tier-1/Tier-2 sources in 24h. Single-source = -30% score penalty.
3. Primary-source provenance (Tier 1 > Tier 2)
4. RECENCY: prefer last 24h, hard cap 72 hours. Anything older than 72h MUST be rejected. Today's date is the reference. If you can't find enough fresh stories, return fewer candidates rather than back-fill with stale stuff. ALWAYS include the published_hint field with a real ISO date or "today"/"yesterday"/"X hours ago" — without it, the date filter can't verify and the story slips through.
5. Visual carousel-ability: clear protagonist (company, person, model, product, robot, demo screen)

DIVERSITY: do NOT return 5 stories that are all "OpenAI does X". Mix companies, types of news, and angles. Force variety across categories.

AVOID (auto-disqualifies even if technically AI news):
- regulatory hand-wringing without a named villain ("EU considers framework for AI"),
- pure benchmarks dump without narrative ("model X scores 67.3 on MMLU"),
- "top 10 AI tools" SEO posts,
- marketing blog posts,
- sponsored content / press releases without independent reporting,
- content farms,
- hot-takes with no news hook,
- philosophical thinkpieces ("is AI conscious?"),
- generic explainers ("what is RAG?").

OUTPUT: return ONLY this JSON, no prose, no markdown fences:
{
  "stories": [
    {
      "title": "exact headline as you'd say it",
      "url": "primary source URL (Tier 1 preferred, Tier 2 acceptable, never Tier 3 or banned)",
      "source": "domain or publication name",
      "source_tier": 1 | 2,
      "published_hint": "ISO date if known, else relative like '2 days ago'",
      "summary": "3-5 sentence factual summary, no embellishment, every claim grounded in what you read",
      "why_it_matters": "1-2 sentences on significance",
      "category": "model_release | research | controversy | tool | business",
      "newsworthiness": 0.0-1.0,
      "viral_signal": "ONE sentence stating WHY this is viral right now (which trending theme from Phase 1 it captures, and where you SAW it spreading: e.g. 'topped HN with 1200 upvotes in 6h + sama/karpathy both posted about it'). Be specific.",
      "related_image_urls": ["0-6 direct image URLs (https://.../foo.jpg|png|webp) tied to THIS story. RULES: every URL MUST be one you actually saw in a web_search result. NEVER invent a URL based on a guessed pattern (e.g. do NOT construct 'cdn.example.com/research/<slug>/hero.png' from a hunch). NEVER guess CDN paths. NEVER reuse a URL pattern from a different story. If you didn't see a real, clickable image URL in search results, return [] for this field. Direct image URLs only, not page URLs."],
      "related_video_urls": ["0-4 PUBLIC video page URLs (YouTube, X/Twitter, Reddit, Vimeo, official press kit) showing the actual event/demo/footage of THIS story. Examples: a YouTube clip of the keynote where the model was announced, a Twitter video of the robot doing the thing, the OFFICIAL demo reel. Only include URLs you literally saw in web_search results. Never invent. Empty array if none found. These will be downloaded with yt-dlp and used as the carousel video background."],
      "entity_x_handles": ["1-3 official X/Twitter handles for the entities in the story (e.g. 'AnthropicAI', 'OpenAI', 'GoogleDeepMind', 'AIatMeta', 'sama', 'elonmusk'). NO @ prefix. We'll scrape the latest video from each handle's recent posts. Pick the OFFICIAL handle that announced the news, plus optionally the founder/CEO handle if relevant."]
    }
  ]
}

URL HALLUCINATION CHECK (do this before returning)
- Re-read each "url", "related_image_urls", and "related_video_urls" entry. Did web_search actually surface this exact URL? If not, drop it.
- Empty arrays are better than fabricated URLs.`;

export async function researchViaWebSearch(limit: number, feed: FeedKind = "viral"): Promise<Article[]> {
  const today = new Date().toISOString().slice(0, 10);
  const feedCfg = FEEDS[feed];
  const userMsg = `Today is ${today}. PIPELINE = ${feed.toUpperCase()} (${feedCfg.label}).

YOUR JOB IS TWO-PHASE:

PHASE 1 — TREND DISCOVERY (mandatory, run first):
Use web_search to actively scrape these EXACT sources and figure out what's hot in AI for THIS pipeline RIGHT NOW. Don't summarize from training data — search live.
${feedCfg.sourceHints}

QUERY HINTS (run 6-10 of these via web_search, mix and match):
${feedCfg.queries.map((q) => `- ${q}`).join("\n")}
Add follow-up searches when you spot a hot signal (e.g. if you see "DeepSeek V4" trending on HN, search "DeepSeek V4 announcement" + "DeepSeek V4 demo" to triangulate).

PHASE 2 — STORY PICK + ASSET HARVEST:
For each viral signal you found, use web_search again to:
- find the primary-source URL (Tier 1 lab blog > Tier 2 outlet)
- collect 0-6 IMAGE URLs you actually saw in search results (og:image, hero shots, charts, screenshots) — NEVER fabricate URLs
- collect 0-4 VIDEO URLs (X/Twitter status URLs, YouTube video URLs, official press videos)
- collect 1-3 entity X handles (the official org / founder posting about it)

SELECTION RULE FOR THIS PIPELINE:
${feedCfg.selectionRule}

Find the top stories matching this pipeline from the last 24-48h. Return at least ${Math.max(limit + 2, 5)} candidates so I can pick the best ${limit}. Use web_search aggressively before writing JSON.

CRITICAL: never invent URLs. If web_search did not surface a clickable URL, return [] for that field.`;

  log.step("research", `streaming feed=${feed} via Claude ${config.models.contentModel} + web_search`);

  const stream = anthropic.messages.stream({
    model: config.models.contentModel,
    max_tokens: 8192,
    // Cache the long static SYSTEM block (~3.5k tokens). 90% discount on cached reads
    // when same system reused within 5 min (e.g. multiple feeds fired in quick succession).
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    messages: [{ role: "user", content: userMsg }],
  });

  let textBuf = "";
  let inText = false;
  let searchCount = 0;
  let resultCount = 0;

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "server_tool_use" && block.name === "web_search") {
        searchCount += 1;
        log.tool("research", `web_search #${searchCount} starting…`);
      } else if (block.type === "web_search_tool_result") {
        resultCount += 1;
        const rc = (block.content as unknown[] | undefined)?.length ?? 0;
        log.tool("research", `web_search result #${resultCount}: ${rc} hits`);
      } else if (block.type === "text") {
        if (!inText) {
          inText = true;
          log.info("research", "model writing JSON…");
        }
      }
    } else if (event.type === "content_block_stop") {
      if (inText) {
        inText = false;
      }
    }
  });

  stream.on("inputJson", (delta, snapshot) => {
    const query = (snapshot as { query?: string } | null)?.query;
    if (typeof query === "string" && query.length > 0) {
      process.stdout.write(`\r${log.dim(`        query: "${query.slice(0, 80)}"`)}`);
    }
  });

  stream.on("text", (delta) => {
    textBuf += delta;
    process.stdout.write(log.dim(delta));
  });

  const final = await stream.finalMessage();
  log.newline();
  const u = final.usage as typeof final.usage & { cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  const cacheW = u.cache_creation_input_tokens ?? 0;
  const cacheR = u.cache_read_input_tokens ?? 0;
  log.ok("research", `stop_reason=${final.stop_reason} searches=${searchCount} input=${final.usage.input_tokens} output=${final.usage.output_tokens} cache_w=${cacheW} cache_r=${cacheR}`);

  const json = extractJson(textBuf);
  const parsed = ListSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`web-search research returned invalid JSON: ${parsed.error.toString()}\nraw: ${textBuf.slice(0, 600)}`);
  }

  // Validate URLs (drop hallucinated ones)
  await Promise.all(parsed.data.stories.map(async (s) => {
    if (!s.related_image_urls.length) return;
    const verified = await Promise.all(s.related_image_urls.map(async (u) => {
      try {
        const r = await fetch(u, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(6000) });
        if (r.ok) return u;
        // some servers reject HEAD; try GET range
        const r2 = await fetch(u, { method: "GET", headers: { Range: "bytes=0-2048" }, signal: AbortSignal.timeout(6000) });
        return r2.ok ? u : null;
      } catch {
        return null;
      }
    }));
    s.related_image_urls = verified.filter((u): u is string => !!u);
  }));

  // Drop banned domains AND stories older than MAX_STORY_AGE_HOURS (default 72h)
  const maxAgeHours = Number.parseInt(process.env.MAX_STORY_AGE_HOURS ?? "72", 10);
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();
  const filtered = parsed.data.stories.filter((s) => {
    if (isBannedDomain(s.url)) return false;
    const pub = parseDate(s.published_hint);
    if (pub && now - pub.getTime() > maxAgeMs) {
      log.warn("research", `dropping stale story (${Math.round((now - pub.getTime()) / 3600_000)}h > ${maxAgeHours}h cap): ${s.title.slice(0, 60)}`);
      return false;
    }
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    const tierA = a.source_tier === 1 ? 1.0 : 0.7;
    const tierB = b.source_tier === 1 ? 1.0 : 0.7;
    return (b.newsworthiness * tierB) - (a.newsworthiness * tierA);
  });
  log.ok("research", `parsed ${parsed.data.stories.length} stories (${parsed.data.stories.length - filtered.length} dropped as banned source), taking top ${limit}`);
  return sorted.slice(0, limit).map((s) => ({
    id: createHash("sha1").update(s.url).digest("hex").slice(0, 16),
    source: s.source,
    url: s.url,
    title: s.title,
    body: `${s.summary}\n\nWhy it matters: ${s.why_it_matters}`,
    publishedAt: parseDate(s.published_hint) ?? new Date(),
    topicScore: s.newsworthiness,
    relatedImageUrls: s.related_image_urls,
    relatedVideoUrls: s.related_video_urls,
    entityXHandles: s.entity_x_handles,
  }));
}

const BANNED_DOMAINS = [
  // marktechpost.com — un-banned per user 2026-05-11: kept as approved AI-focused outlet
  "analyticsindiamag.com",
  "analyticsvidhya.com",
  "geekflare.com",
  "kdnuggets.com",
  "machinelearningmastery.com",
  "towardsdatascience.com",
  "becominghuman.ai",
  "medium.com",
  "dev.to",
  "hackernoon.com",
  "contentdrips.com",
  "postnitro.ai",
  "aifreeforever.com",
  "readless.app",
  "dupple.com",
  "crescendo.ai",
  "caniphish.com",
];

function isBannedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return BANNED_DOMAINS.some((b) => host === b || host.endsWith(`.${b}`));
  } catch {
    return false;
  }
}

function parseDate(hint?: string): Date | null {
  if (!hint) return null;
  const d = new Date(hint);
  return Number.isFinite(d.getTime()) ? d : null;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  return tryParse(cleaned, "web-search");
}

function tryParse(cleaned: string, label: string): unknown {
  // 1. Direct JSON.parse
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // 2. Slice between first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1) {
    const sliced = cleaned.slice(start, end + 1);
    try { return JSON.parse(sliced); } catch { /* fall through */ }
    // 3. jsonrepair (handles trailing commas, unescaped chars, smart quotes, etc.)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { jsonrepair } = require("jsonrepair") as { jsonrepair: (s: string) => string };
      return JSON.parse(jsonrepair(sliced));
    } catch (e) {
      throw new Error(`${label} JSON parse failed (even after repair): ${(e as Error).message}\nfirst 300: ${cleaned.slice(0, 300)}`);
    }
  }
  throw new Error(`${label}: no JSON object in output: ${cleaned.slice(0, 300)}`);
}

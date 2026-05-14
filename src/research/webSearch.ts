// Prompts moved to prompts/research-system.md + prompts/research-user.md.
// Edit those files instead of inline strings here. Loader caches + hot-reloads.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { log } from "../log.js";
import { skills } from "../skills/loader.js";
import { getActiveLlmProvider } from "../llm/textGen.js";
import { FEEDS, type FeedKind } from "./feeds.js";
import { fetchEditorialCandidates, formatCandidatesBlock } from "./editorialFeeds.js";
import { extractJson } from "../util/json.js";
import { loadDeliveryConfig } from "../delivery/config.js";
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


export async function researchViaWebSearch(limit: number, feed: FeedKind = "viral"): Promise<Article[]> {
  const today = new Date().toISOString().slice(0, 10);
  const feedCfg = FEEDS[feed];

  // Pre-fetch editorial RSS feeds (real-time signal from 24 sources).
  const editorialItems = await fetchEditorialCandidates({ limit: 30, maxAgeHours: 24 }).catch(() => []);
  const candidatesBlock = formatCandidatesBlock(editorialItems);

  // Prompts via skills loader.
  const SYSTEM = skills.research.system();
  const userMsg = skills.research.user({
    today,
    feedUpper: feed.toUpperCase(),
    feedLabel: feedCfg.label,
    sourceHints: feedCfg.sourceHints + candidatesBlock,
    queries: feedCfg.queries.map((q) => `- ${q}`).join("\n"),
    selectionRule: feedCfg.selectionRule,
    minCandidates: Math.max(limit + 2, 5),
  });

  // Branch by provider. Claude = native web_search_20250305 tool, prompt-caching discount.
  // OpenRouter (DeepSeek V3.1) = openrouter:web_search server tool, ~82% cheaper per token.
  // Gemini text models don't have a server-side web_search yet — fall back to Claude.
  const provider = await getActiveLlmProvider();
  const textBuf = provider === "openrouter"
    ? await runOpenRouterResearch({ system: SYSTEM, user: userMsg, feed })
    : await runClaudeResearch({ system: SYSTEM, user: userMsg, feed });

  const json = extractJson(textBuf, "research");
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
  const maxAgeHours = Number.parseInt(process.env.MAX_STORY_AGE_HOURS ?? "24", 10);
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

/** Claude path — Anthropic SDK with native web_search_20250305 server tool. */
async function runClaudeResearch(opts: { system: string; user: string; feed: FeedKind }): Promise<string> {
  log.step("research", `streaming feed=${opts.feed} via Claude ${config.models.contentModel} + web_search`);
  const stream = anthropic.messages.stream({
    model: config.models.contentModel,
    max_tokens: 8192,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    messages: [{ role: "user", content: opts.user }],
  });

  let textBuf = "";
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
      }
    }
  });

  stream.on("inputJson", (_delta, snapshot) => {
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
  log.ok("research", `claude stop=${final.stop_reason} searches=${searchCount} in=${final.usage.input_tokens} out=${final.usage.output_tokens} cache_w=${u.cache_creation_input_tokens ?? 0} cache_r=${u.cache_read_input_tokens ?? 0}`);
  return textBuf;
}

/** OpenRouter path — DeepSeek V3.1 + openrouter:web_search server tool.
 *  OpenRouter runs the search server-side, model gets grounded results inline. */
async function runOpenRouterResearch(opts: { system: string; user: string; feed: FeedKind }): Promise<string> {
  const cfg = await loadDeliveryConfig().catch(() => null);
  const apiKey = cfg?.openrouterApiKey || config.openrouterApiKey;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required for openrouter research path");
  const model = cfg?.openrouterModel || config.openrouterModel;
  const client = new OpenAI({
    apiKey,
    baseURL: config.openrouterBaseUrl,
    defaultHeaders: { "HTTP-Referer": "https://github.com/ai-carousel-factory", "X-Title": "AI Carousel Factory" },
  });

  log.step("research", `streaming feed=${opts.feed} via OpenRouter ${model} + openrouter:web_search`);
  const t0 = Date.now();
  const stream = await client.chat.completions.create({
    model,
    max_tokens: 8192,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    // OpenRouter server tool — searches the web inline, grounds the response.
    // $0.02/request via Exa (5 results max). Costs added to OpenRouter credits.
    tools: [{ type: "function", function: { name: "openrouter:web_search" } }] as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
  });

  let textBuf = "";
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      textBuf += delta;
      process.stdout.write(log.dim(delta));
    }
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0;
      outputTokens = chunk.usage.completion_tokens ?? 0;
    }
  }
  log.newline();
  log.ok("research", `openrouter returned in ${((Date.now() - t0) / 1000).toFixed(1)}s, in=${inputTokens} out=${outputTokens}`);
  return textBuf;
}


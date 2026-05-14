import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { extractJson } from "../util/json.js";
import { log } from "../log.js";
import { generateText } from "../llm/textGen.js";
import { SlideSpecSchema, type SlideSpec } from "../types.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { loadPlaybook } from "./playbook.js";
import { pickEligibleFormats, recordFormat, ALL_FORMATS, type FormatName } from "./recentFormats.js";
import type { Article } from "../types.js";

export class InsufficientSourceError extends Error {
  constructor() {
    super("insufficient_source_material");
  }
}

export async function generateSlideSpec(article: Article, feed?: string): Promise<SlideSpec> {
  // AI-decided slide count. Pass MIN/MAX as a RANGE to the model — it picks the count
  // that best fits THIS article's depth (sparse story = 3 slides, rich story = 5).
  // The system prompt instructs the model to choose.
  const minS = Math.max(2, Math.min(10, Number.parseInt(process.env.MIN_SLIDES ?? "3", 10) || 3));
  const maxS = Math.max(minS, Math.min(10, Number.parseInt(process.env.MAX_SLIDES_RANDOM ?? "5", 10) || 5));
  // We still send the upper bound to the prompt so the model knows the cap, but
  // accept body_slides arrays of any length in [minS-1, maxS-1] in enforceQualityGates.
  const maxSlides = maxS;
  const expectedBody = Math.max(1, maxSlides - 1);
  log.step("content", `streaming SlideSpec (${maxSlides} slides total) for "${article.title.slice(0, 60)}"`);

  const playbook = await loadPlaybook().catch((e) => {
    log.warn("content", `playbook load failed: ${(e as Error).message}`);
    return undefined;
  });
  const eligibleFormats = await pickEligibleFormats();
  log.info("content", `eligible formats: ${eligibleFormats.join(", ")}`);

  const systemText = buildSystemPrompt(maxSlides, playbook, eligibleFormats, minS);
  // claude path caches the system block (~8-12k tokens) for a 90% input-token discount
  // on cache hits within 5 min. Gemini path has no caching but a generous free tier.
  const result = await generateText({
    system: systemText,
    user: buildUserPrompt({ ...article, feed }, config.brand.handle, maxSlides),
    maxTokens: 4096,
    onTextDelta: (delta) => process.stdout.write(log.dim(delta)),
  });

  log.newline();
  const cacheTag = result.cacheCreate || result.cacheRead ? ` cache_w=${result.cacheCreate} cache_r=${result.cacheRead}` : "";
  log.ok("content", `provider=${result.provider} model=${result.model} stop_reason=${result.stopReason} input=${result.inputTokens} output=${result.outputTokens}${cacheTag}`);

  const json = extractJson(result.text, "slide-spec");

  if (typeof json === "object" && json !== null && "error" in json && (json as Record<string, unknown>).error === "insufficient_source_material") {
    throw new InsufficientSourceError();
  }

  const candidate = json as Record<string, unknown>;
  if (!candidate.carousel_id) candidate.carousel_id = randomUUID();
  if (!candidate.source_url) candidate.source_url = article.url;
  if (article.relatedImageUrls?.length && !candidate.related_image_urls) {
    candidate.related_image_urls = article.relatedImageUrls;
  }
  if (article.relatedVideoUrls?.length && !candidate.related_video_urls) {
    candidate.related_video_urls = article.relatedVideoUrls;
  }
  if (article.entityXHandles?.length && !candidate.entity_x_handles) {
    candidate.entity_x_handles = article.entityXHandles;
  }
  scrubNulls(candidate);
  stripDashes(candidate);
  softTruncate(candidate);

  const parsed = SlideSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`SlideSpec validation failed: ${parsed.error.toString()}`);
  }

  // AI picks count: accept any body count in [minS-1, maxS-1]. Caller passes minS.
  enforceQualityGates(parsed.data, expectedBody, Math.max(1, minS - 1));

  const usedFormat = (candidate.carousel_format as string | undefined) ?? "";
  if (ALL_FORMATS.includes(usedFormat as FormatName)) {
    await recordFormat(usedFormat as FormatName).catch(() => undefined);
    log.ok("content", `spec valid (format=${usedFormat}): ${parsed.data.body_slides.length} body + hook + cta`);
  } else {
    log.ok("content", `spec valid: ${parsed.data.body_slides.length} body slides + hook + cta`);
  }
  return parsed.data;
}


function scrubNulls(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) {
      if (obj[i] === null) obj[i] = undefined;
      else if (typeof obj[i] === "object") scrubNulls(obj[i]);
    }
    return;
  }
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (rec[k] === null) delete rec[k];
      else if (typeof rec[k] === "object") scrubNulls(rec[k]);
    }
  }
}

const DASH_RE = /\s*[—–]\s*/g;

function killDashes(s: string): string {
  return s.replace(DASH_RE, ", ").replace(/\s+,/g, ",").replace(/,\s*$/, "");
}

function stripDashes(c: Record<string, unknown>): void {
  // Recursively walk every string: strip em/en dashes + trailing ellipsis (looks like "...")
  const cleanString = (s: string): string => {
    let out = killDashes(s);
    // Strip trailing literal "..." or unicode "…" plus any whitespace before
    out = out.replace(/[.\s]*(\.\.\.|…)\s*$/g, "");
    return out;
  };
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return cleanString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const k of Object.keys(obj)) obj[k] = walk(obj[k]);
      return obj;
    }
    return node;
  };
  walk(c);
}

function softTruncate(c: Record<string, unknown>): void {
  const clipKey = (obj: Record<string, unknown>, key: string, max: number) => {
    const v = obj[key];
    if (typeof v === "string") obj[key] = clip(v, max);
  };
  const clipArr = (obj: Record<string, unknown>, key: string, max: number) => {
    const v = obj[key];
    if (Array.isArray(v)) obj[key] = v.map((x) => (typeof x === "string" ? clip(x, max) : x));
  };

  const hook = c.hook_slide as Record<string, unknown> | undefined;
  if (hook) {
    clipKey(hook, "headline", 80);
    clipKey(hook, "sub_tagline", 50);
    clipKey(hook, "background_scene", 180);
    clipArr(hook, "highlight_phrases", 60);
    clipArr(hook, "ticker_phrases", 60);
  }
  const cta = c.cta_slide as Record<string, unknown> | undefined;
  if (cta) {
    clipKey(cta, "headline", 100);
    clipArr(cta, "highlight_phrases", 60);
  }
  const bodies = c.body_slides as Record<string, unknown>[] | undefined;
  if (Array.isArray(bodies)) {
    for (const b of bodies) {
      clipKey(b, "headline", 100);
      clipKey(b, "body_text", 160);
      clipKey(b, "stat_value", 40);
      clipKey(b, "stat_caption", 140);
      clipKey(b, "pull_quote", 200);
      clipKey(b, "quote_attribution", 80);
      clipKey(b, "list_title", 80);
      clipArr(b, "highlight_phrases", 60);
      clipArr(b, "list_items", 120);
    }
  }
  if (typeof c.instagram_caption === "string") c.instagram_caption = clip(c.instagram_caption, 2200);
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  // Hard cut at last sentence boundary or last whitespace before max. No ellipsis (renders as "..." on slides).
  const slice = s.slice(0, max);
  const lastPunct = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastPunct > max * 0.6) return slice.slice(0, lastPunct + 1);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > max * 0.6) return slice.slice(0, lastSpace);
  return slice;
}

function enforceQualityGates(spec: SlideSpec, expectedMaxBody: number, minBodyOverride?: number): void {
  const minBody = Math.max(1, minBodyOverride ?? expectedMaxBody - 1);
  if (spec.body_slides.length > expectedMaxBody) {
    spec.body_slides.length = expectedMaxBody;
  } else if (spec.body_slides.length < minBody) {
    throw new Error(`Need at least ${minBody} body slides, model returned ${spec.body_slides.length}`);
  }
  const hookHl = spec.hook_slide.headline.toLowerCase();
  const droppedHook = spec.hook_slide.highlight_phrases.filter((p) => !hookHl.includes(p.toLowerCase()));
  if (droppedHook.length) {
    log.warn("content", `dropping hook highlight phrases not in headline: ${droppedHook.map((p) => `"${p}"`).join(", ")}`);
    spec.hook_slide.highlight_phrases = spec.hook_slide.highlight_phrases.filter((p) => hookHl.includes(p.toLowerCase()));
  }
  for (const slide of spec.body_slides) {
    const hl = slide.headline.toLowerCase();
    const dropped = slide.highlight_phrases.filter((p) => !hl.includes(p.toLowerCase()));
    if (dropped.length) {
      log.warn("content", `body slide ${slide.slide_number}: dropping ${dropped.map((p) => `"${p}"`).join(", ")} (not in headline)`);
      slide.highlight_phrases = slide.highlight_phrases.filter((p) => hl.includes(p.toLowerCase()));
    }
  }
  if (spec.hook_slide.headline !== spec.hook_slide.headline.toUpperCase()) {
    throw new Error("Hook headline must be uppercase");
  }
  // Per May 2026 IG research: hooks over 10 words tank swipe-through. Soft-warn at 12.
  const hookWords = spec.hook_slide.headline.trim().split(/\s+/).length;
  if (hookWords > 12) {
    log.warn("content", `hook is ${hookWords} words (target ≤10). Reads heavy on mobile.`);
  }

  // Enforce body-variant variety (visual rhythm). Client May 2026: "2nd + 3rd carousel
  // had same style". Force consecutive body slides to use different layout_variants.
  const variantPool: ("text_explainer" | "stat_card" | "quote_pull" | "list_card")[] =
    ["text_explainer", "stat_card", "quote_pull", "list_card"];
  for (let i = 1; i < spec.body_slides.length; i += 1) {
    const cur = spec.body_slides[i]!;
    const prev = spec.body_slides[i - 1]!;
    if (cur.layout_variant === prev.layout_variant) {
      const next = variantPool.find((v) => v !== prev.layout_variant && v !== "text_explainer") ?? "stat_card";
      log.warn("content", `body slide ${cur.slide_number}: rotating ${cur.layout_variant} → ${next} (same as prev slide, breaks rhythm)`);
      cur.layout_variant = next;
    }
  }
}

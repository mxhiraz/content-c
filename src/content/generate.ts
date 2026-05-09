import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { log } from "../log.js";
import { SlideSpecSchema, type SlideSpec } from "../types.js";
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { loadPlaybook } from "./playbook.js";
import { pickEligibleFormats, recordFormat, ALL_FORMATS, type FormatName } from "./recentFormats.js";
import type { Article } from "../types.js";

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export class InsufficientSourceError extends Error {
  constructor() {
    super("insufficient_source_material");
  }
}

export async function generateSlideSpec(article: Article): Promise<SlideSpec> {
  const maxSlides = config.pipeline.maxSlides;
  const expectedBody = Math.max(1, maxSlides - 1);
  log.step("content", `streaming SlideSpec (${maxSlides} slides total) for "${article.title.slice(0, 60)}"`);

  const playbook = await loadPlaybook().catch((e) => {
    log.warn("content", `playbook load failed: ${(e as Error).message}`);
    return undefined;
  });
  const eligibleFormats = await pickEligibleFormats();
  log.info("content", `eligible formats: ${eligibleFormats.join(", ")}`);

  const stream = anthropic.messages.stream({
    model: config.models.contentModel,
    max_tokens: 4096,
    system: buildSystemPrompt(maxSlides, playbook, eligibleFormats),
    messages: [{ role: "user", content: buildUserPrompt(article, config.brand.handle, maxSlides) }],
  });

  let buf = "";
  stream.on("text", (delta) => {
    buf += delta;
    process.stdout.write(log.dim(delta));
  });

  const final = await stream.finalMessage();
  log.newline();
  log.ok("content", `stop_reason=${final.stop_reason} input_tok=${final.usage.input_tokens} output_tok=${final.usage.output_tokens}`);

  const json = extractJson(buf);

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

  enforceQualityGates(parsed.data, expectedBody);

  const usedFormat = (candidate.carousel_format as string | undefined) ?? "";
  if (ALL_FORMATS.includes(usedFormat as FormatName)) {
    await recordFormat(usedFormat as FormatName).catch(() => undefined);
    log.ok("content", `spec valid (format=${usedFormat}): ${parsed.data.body_slides.length} body + hook + cta`);
  } else {
    log.ok("content", `spec valid: ${parsed.data.body_slides.length} body slides + hook + cta`);
  }
  return parsed.data;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  // 1. Direct
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  // 2. Slice between first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON in model output: ${text.slice(0, 200)}`);
  const sliced = cleaned.slice(start, end + 1);
  try { return JSON.parse(sliced); } catch { /* fall through */ }
  // 3. jsonrepair fallback (trailing commas, unescaped quotes/newlines, smart quotes, etc.)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { jsonrepair } = require("jsonrepair") as { jsonrepair: (s: string) => string };
    return JSON.parse(jsonrepair(sliced));
  } catch (e) {
    throw new Error(`SlideSpec JSON parse failed (even after repair): ${(e as Error).message}\nfirst 300: ${cleaned.slice(0, 300)}`);
  }
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
  const clean = (obj: Record<string, unknown>, key: string) => {
    const v = obj[key];
    if (typeof v === "string") obj[key] = killDashes(v);
  };
  const cleanArr = (obj: Record<string, unknown>, key: string) => {
    const v = obj[key];
    if (Array.isArray(v)) obj[key] = v.map((x) => (typeof x === "string" ? killDashes(x) : x));
  };

  const hook = c.hook_slide as Record<string, unknown> | undefined;
  if (hook) {
    clean(hook, "headline");
    clean(hook, "sub_tagline");
    cleanArr(hook, "highlight_phrases");
    cleanArr(hook, "ticker_phrases");
  }
  const cta = c.cta_slide as Record<string, unknown> | undefined;
  if (cta) {
    clean(cta, "headline");
    cleanArr(cta, "highlight_phrases");
  }
  const bodies = c.body_slides as Record<string, unknown>[] | undefined;
  if (Array.isArray(bodies)) {
    for (const b of bodies) {
      clean(b, "headline");
      clean(b, "body_text");
      cleanArr(b, "highlight_phrases");
    }
  }
  clean(c, "instagram_caption");
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
      clipKey(b, "body_text", 280);
      clipKey(b, "stat_value", 40);
      clipKey(b, "stat_caption", 80);
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
  const cut = s.slice(0, max - 1).replace(/[\s,;:.\-—]+$/, "");
  return `${cut}…`;
}

function enforceQualityGates(spec: SlideSpec, expectedBody: number): void {
  const minBody = Math.max(1, expectedBody - 1);
  if (spec.body_slides.length > expectedBody) {
    spec.body_slides.length = expectedBody;
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
}

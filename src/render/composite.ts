import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { config } from "../config.js";
import type { BodySlide, HookSlide } from "../types.js";

// 1080×1350 (4:5 portrait) — IG's official recommended post size.
// Per client direction 2026-05-13. Cycled through 1350 → 1080 → 1440 → 1350 same day.
const W = 1080;
const H = 1350;
const PAD = 72;
const WHITE = "#FFFFFF";
const BLACK = "#000000";
const DIM = "#9CA3AF";

let accent = config.brand.highlightColor;
export function setAccent(hex: string): void {
  accent = hex;
}
function PURPLE(): string {
  return accent;
}

export async function extractAccentColor(buf: Buffer): Promise<string> {
  try {
    const { data, info } = await sharp(buf)
      .resize(96, 96, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let bestScore = 0;
    let best = { r: 168, g: 85, b: 247 };
    const stride = info.channels;
    for (let i = 0; i < data.length; i += stride) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (r + g + b) / 3;
      // Reject muddy / unreadable accents:
      // - too dark (lum < 60) => no contrast against black
      // - too light (lum > 220) => no contrast against white text
      // - low saturation (< 0.45) => muddy brown/grey
      if (lum < 60 || lum > 220) continue;
      if (sat < 0.45) continue;
      // Score favors high saturation + mid luminance
      const lumPenalty = Math.abs(lum - 145) / 145; // 0 at lum=145, 1 at extremes
      const score = sat * (1 - lumPenalty * 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = { r, g, b };
      }
    }
    if (bestScore < 0.4) return config.brand.highlightColor;
    return `#${[best.r, best.g, best.b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  } catch {
    return config.brand.highlightColor;
  }
}

// Font stack curated from May 2026 IG carousel research:
// - Hooks (huge condensed): Anton — top "attention-grabbing headline" font of 2026
// - Body (clean readable): Montserrat / Inter / DM Sans — top social-media body fonts
// All three bundled in Docker via apt + Google Fonts. Mac fallback to system fonts.
const FONT_DISPLAY = "Anton, 'Bebas Neue', 'Impact', 'Liberation Sans Bold', 'Helvetica Neue', sans-serif"; // ultra-bold condensed for hooks
const FONT_SANS = "Montserrat, Inter, 'DM Sans', 'Liberation Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const FONT_SERIF = "'Liberation Serif', Georgia, 'Times New Roman', serif";
const FONT_MONO = "'DM Mono', 'JetBrains Mono', 'Liberation Mono', Menlo, monospace";

export interface CompositeOptions {
  slide: BodySlide;
  total: number;
  attachedImage?: Buffer;
  brandHandle: string;
  topicCategory?: string;
}

export interface HookCompositeOptions {
  hook: HookSlide;
  subjectImage: Buffer;
  logoImages: Buffer[];
  brandHandle: string;
  topicCategory?: string;
}

export type HookStyle = "panel" | "overlay" | "magazine";

export async function compositeHookSlide(opts: HookCompositeOptions, style: HookStyle = "panel"): Promise<Buffer> {
  const layout = await renderHookLayout(opts, style);
  if (style === "panel") {
    drawHookHeadline(layout.ctx, opts.hook, layout.photoH);
    drawHookSubTagline(layout.ctx, opts.hook);
  } else if (style === "overlay") {
    drawOverlayHeadline(layout.ctx, opts.hook);
  } else {
    drawMagazineHeadline(layout.ctx, opts.hook);
  }
  // No branding — no niche badge, no wordmark. Client May 2026: pure content.
  // SWIPE chip stays (functional UI, not brand).
  drawSwipeChip(layout.ctx);
  return layout.canvas.toBuffer("image/png");
}

export async function compositeHookBase(opts: HookCompositeOptions, style: HookStyle = "panel"): Promise<{ buffer: Buffer; photoH: number; style: HookStyle }> {
  const layout = await renderHookLayout(opts, style);
  return { buffer: layout.canvas.toBuffer("image/png"), photoH: layout.photoH, style };
}

const TOPIC_KICKER: Record<string, string> = {
  model_release: "AI · MODEL DROP",
  research: "AI · RESEARCH",
  controversy: "AI · DRAMA",
  tool: "AI · NEW TOOL",
  business: "AI · BUSINESS",
};

export function compositeHookTextOverlay(hook: HookSlide, topicCategory?: string): Buffer {
  // Split layout: top half = transparent (source video shows through),
  // bottom half = SOLID black panel + headline. Mirrors body overlay so text
  // never fights a busy video background. Picked per May 2026 IG research:
  // "scrim / solid panel behind text is the reliable readability fix".
  const canvas: Canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const PHOTO_H = Math.round(H * 0.52);
  // Bridge gradient: smooths seam between video top and black panel.
  const bridge = ctx.createLinearGradient(0, PHOTO_H - 120, 0, PHOTO_H + 40);
  bridge.addColorStop(0, "rgba(0,0,0,0)");
  bridge.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = bridge;
  ctx.fillRect(0, PHOTO_H - 120, W, 160);
  // Solid black panel, fully opaque so text always 100% legible.
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, PHOTO_H, W, H - PHOTO_H);

  const kicker = topicCategory ? (TOPIC_KICKER[topicCategory] ?? "AI") : "AI";
  drawVideoHookPanel(ctx, hook, PHOTO_H, kicker);
  return canvas.toBuffer("image/png");
}

function drawKickerTag(ctx: SKRSContext2D, label: string, y: number): void {
  // Centered uppercase kicker w/ horizontal lines on either side ("— TECHNOLOGY —").
  ctx.font = `700 22px ${FONT_MONO}`;
  ctx.fillStyle = WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelW = ctx.measureText(label).width;
  ctx.fillText(label, W / 2, y);
  // Dashes on either side
  const gap = 24;
  const lineLen = 80;
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - labelW / 2 - gap, y);
  ctx.lineTo(W / 2 - labelW / 2 - gap - lineLen, y);
  ctx.moveTo(W / 2 + labelW / 2 + gap, y);
  ctx.lineTo(W / 2 + labelW / 2 + gap + lineLen, y);
  ctx.stroke();
  ctx.textAlign = "left";
}

function drawVideoHookPanel(ctx: SKRSContext2D, hook: HookSlide, photoH: number, kicker: string): void {
  const headline = hook.headline.toUpperCase();
  const highlights = hook.highlight_phrases.map((p) => p.toUpperCase());
  // Kicker tag sits at top of panel, headline starts below.
  drawKickerTag(ctx, kicker, photoH + 36);
  const panelTop = photoH + 76;
  const panelBottom = H - 140;
  const panelH = panelBottom - panelTop;
  const maxW = W - PAD * 2;

  let fontSize = 96;
  let lines: string[] = [];
  let lineH = 0;
  for (; fontSize >= 44; fontSize -= 4) {
    ctx.font = `${fontSize}px ${FONT_DISPLAY}`;
    lines = wrapLines(ctx, headline, maxW);
    lineH = fontSize * 0.98;
    if (lines.length * lineH <= panelH) break;
  }
  ctx.textBaseline = "top";
  const totalH = lines.length * lineH;
  const startY = panelTop + (panelH - totalH) / 2;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    drawHighlightedLine(ctx, line, highlights, W / 2, startY + i * lineH, fontSize);
  }

  // Sub tag (purple) below headline, big enough to read on mobile.
  if (hook.sub_tagline) {
    ctx.font = `800 30px ${FONT_SANS}`;
    ctx.fillStyle = PURPLE();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(hook.sub_tagline.toUpperCase(), W / 2, H - 86);
  }

  // Swipe indicator: chip is drawn separately by compositeHookSlide → drawSwipeChip.
  // No duplicate centered text — would collide with the bottom-right pill.
  ctx.textAlign = "left";
}

// Map spec topic_category → display label. Broadened May 2026 — broad-sector news,
function drawSwipeChip(ctx: SKRSContext2D): void {
  // Bottom-right rounded pill "SWIPE →" matching universal DNA.
  const text = "SWIPE  →";
  ctx.save();
  ctx.font = `800 20px ${FONT_SANS}`;
  const metrics = ctx.measureText(text);
  const padX = 18;
  const w = metrics.width + padX * 2;
  const h = 36;
  const x = W - PAD - w;
  const y = H - PAD - h;
  // Pill background — semitransparent black with subtle border
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  const radius = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

export function compositeBodyTextOverlay(slide: BodySlide, total: number, topicCategory?: string): Buffer {
  const canvas: Canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const PHOTO_H = Math.round(H * 0.5);
  // Top half: leave transparent so source video shows through
  // Bridge gradient over the seam
  const bridge = ctx.createLinearGradient(0, PHOTO_H - 100, 0, PHOTO_H + 30);
  bridge.addColorStop(0, "rgba(0,0,0,0)");
  bridge.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = bridge;
  ctx.fillRect(0, PHOTO_H - 100, W, 130);
  // Bottom half: solid black panel
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, PHOTO_H, W, H - PHOTO_H);

  const headline = slide.headline.toUpperCase();
  const highlights = slide.highlight_phrases.map((p) => p.toUpperCase());
  const emphasis = slide.body_emphasis_phrases ?? [];

  const panelTop = PHOTO_H + 40;
  ctx.textBaseline = "top";

  let titleSize = 52;
  let titleLines: string[] = [];
  let titleLineH = 0;
  for (; titleSize >= 30; titleSize -= 2) {
    ctx.font = `900 ${titleSize}px ${FONT_SANS}`;
    titleLines = wrapLines(ctx, headline, W - PAD * 2);
    titleLineH = titleSize * 1.05;
    if (titleLines.length * titleLineH <= 220) break;
  }
  for (let i = 0; i < titleLines.length; i += 1) {
    const line = titleLines[i];
    if (!line) continue;
    drawHighlightedHeadlineLine(ctx, line, highlights, PAD, panelTop + i * titleLineH, titleSize);
  }
  const titleEnd = panelTop + titleLines.length * titleLineH + 20;

  ctx.fillStyle = WHITE;
  ctx.textAlign = "left";
  drawEmphasizedParagraph(ctx, slide.body_text, emphasis, PAD, titleEnd, W - PAD * 2, 28, 36);

  // slide number bottom right
  ctx.font = `600 22px ${FONT_MONO}`;
  ctx.fillStyle = PURPLE();
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${String(slide.slide_number).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, W - PAD, H - 48);

  // No branding — niche badge removed per client May 2026 (pure content).
  void topicCategory;

  return canvas.toBuffer("image/png");
}

async function renderHookLayout(opts: HookCompositeOptions, style: HookStyle): Promise<{ canvas: Canvas; ctx: SKRSContext2D; photoH: number }> {
  const canvas: Canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, W, H);

  let photoH = Math.round(H * 0.62);
  if (style === "overlay") photoH = H;
  if (style === "magazine") photoH = Math.round(H * 0.78);

  const subjectPng = await sharp(opts.subjectImage)
    .resize(W, photoH, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  const subjectImg = await loadImage(subjectPng);
  ctx.drawImage(subjectImg, 0, 0, W, photoH);

  if (style === "panel") {
    const bridge = ctx.createLinearGradient(0, photoH - 120, 0, photoH + 40);
    bridge.addColorStop(0, "rgba(0,0,0,0)");
    bridge.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = bridge;
    ctx.fillRect(0, photoH - 120, W, 160);
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, photoH, W, H - photoH);
  } else if (style === "overlay") {
    // Stronger gradient + solid bottom band so headline is always legible
    // regardless of subject photo busyness (e.g. screenshot backgrounds).
    const grad = ctx.createLinearGradient(0, H * 0.25, 0, H);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.75)");
    grad.addColorStop(0.7, "rgba(0,0,0,0.95)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Hard solid panel under headline zone (bottom 38%) — guarantees contrast
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, Math.round(H * 0.62), W, H - Math.round(H * 0.62));
  } else if (style === "magazine") {
    const top = ctx.createLinearGradient(0, 0, 0, 80);
    top.addColorStop(0, "rgba(0,0,0,0.85)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, 80);
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, photoH, W, H - photoH);
  }

  await drawHookLogos(ctx, opts.logoImages);
  return { canvas, ctx, photoH };
}

function drawOverlayHeadline(ctx: SKRSContext2D, hook: HookSlide): void {
  const headline = hook.headline.toUpperCase();
  const highlights = hook.highlight_phrases.map((p) => p.toUpperCase());

  let fontSize = 110;
  let lines: string[] = [];
  let lineH = 0;
  const maxW = W - PAD * 2;
  for (; fontSize >= 56; fontSize -= 4) {
    ctx.font = `${fontSize}px ${FONT_DISPLAY}`;
    lines = wrapLines(ctx, headline, maxW);
    lineH = fontSize * 0.96;
    if (lines.length * lineH <= H * 0.42) break;
  }
  ctx.textBaseline = "top";
  const totalH = lines.length * lineH;
  const startY = H - 240 - totalH;
  // No kicker / brand text — client direction May 2026 (do not regress)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    drawHighlightedLine(ctx, line, highlights, W / 2, startY + i * lineH, fontSize);
  }
  // sub tag on overlay
  if (hook.sub_tagline) {
    ctx.font = `800 26px ${FONT_SANS}`;
    ctx.fillStyle = PURPLE();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(hook.sub_tagline.toUpperCase(), W / 2, H - 130);
  }
  ctx.textAlign = "left";
}

function drawMagazineHeadline(ctx: SKRSContext2D, hook: HookSlide): void {
  const headline = hook.headline.toUpperCase();
  const highlights = hook.highlight_phrases.map((p) => p.toUpperCase());
  const photoH = Math.round(H * 0.78);
  const panelTop = photoH + 24;
  const panelH = H - panelTop - 60;
  const maxW = W - PAD * 2;
  let fontSize = 84;
  let lines: string[] = [];
  let lineH = 0;
  for (; fontSize >= 40; fontSize -= 3) {
    ctx.font = `${fontSize}px ${FONT_DISPLAY}`;
    lines = wrapLines(ctx, headline, maxW);
    lineH = fontSize * 1.0;
    if (lines.length * lineH <= panelH) break;
  }
  ctx.textBaseline = "top";
  const totalH = lines.length * lineH;
  const startY = panelTop + (panelH - totalH) / 2;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    drawHighlightedLine(ctx, line, highlights, W / 2, startY + i * lineH, fontSize);
  }
}

async function drawHookLogos(ctx: SKRSContext2D, logos: Buffer[]): Promise<void> {
  if (!logos.length) return;
  const size = 130;
  const y = 110;
  const positions = logos.length === 1 ? [W - PAD - size] : [PAD, W - PAD - size];
  for (let i = 0; i < Math.min(logos.length, 2); i += 1) {
    const buf = logos[i];
    if (!buf) continue;
    const xPos = positions[i];
    if (xPos === undefined) continue;
    try {
      const padded = await sharp(buf)
        .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
      const logoImg = await loadImage(padded);
      ctx.save();
      // White rounded square behind logo
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      roundedRect(ctx, xPos, y, size, size, 22);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundedRect(ctx, xPos, y, size, size, 22);
      ctx.clip();
      ctx.drawImage(logoImg, xPos, y, size, size);
      ctx.restore();
    } catch {
      // skip bad logo
    }
  }
}

function drawHookHeadline(ctx: SKRSContext2D, hook: HookSlide, photoBottomY: number): void {
  const headline = hook.headline.toUpperCase();
  const highlights = hook.highlight_phrases.map((p) => p.toUpperCase());

  const panelTop = photoBottomY + 30;
  const panelBottom = H - 100;
  const panelH = panelBottom - panelTop;
  const maxW = W - PAD * 2;

  // Auto-fit font size: try big, shrink if it overflows
  let fontSize = 120;
  let lines: string[] = [];
  let lineH = 0;
  for (; fontSize >= 56; fontSize -= 4) {
    ctx.font = `${fontSize}px ${FONT_DISPLAY}`;
    lines = wrapLines(ctx, headline, maxW);
    lineH = fontSize * 0.98;
    if (lines.length * lineH <= panelH) break;
  }

  ctx.textBaseline = "top";
  const totalH = lines.length * lineH;
  const startY = panelTop + (panelH - totalH) / 2;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const lineY = startY + i * lineH;
    drawHighlightedLine(ctx, line, highlights, W / 2, lineY, fontSize);
  }
}

function drawHighlightedLine(
  ctx: SKRSContext2D,
  line: string,
  highlights: string[],
  centerX: number,
  y: number,
  fontSize: number
): void {
  ctx.font = `${fontSize}px ${FONT_DISPLAY}`;
  ctx.textBaseline = "top";
  const lineWidth = ctx.measureText(line).width;
  let x = centerX - lineWidth / 2;
  const words = line.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!word) continue;
    const isLast = i === words.length - 1;
    const drawn = isLast ? word : `${word} `;
    const isHL = highlights.some((h) => {
      const w = word.replace(/[^A-Z0-9$%]/g, "");
      return h.split(" ").some((hw) => hw.replace(/[^A-Z0-9$%]/g, "") === w);
    });
    ctx.fillStyle = isHL ? PURPLE() : WHITE;
    ctx.fillText(drawn, x, y);
    x += ctx.measureText(drawn).width;
  }
}

function drawHookSubTagline(ctx: SKRSContext2D, hook: HookSlide): void {
  if (!hook.sub_tagline) return;
  const tag = hook.sub_tagline.toUpperCase();
  ctx.font = `800 26px ${FONT_SANS}`;
  ctx.fillStyle = PURPLE();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(tag, W / 2, H - 110);
  ctx.textAlign = "left";
}

function wrapLines(ctx: SKRSContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function compositeBodySlide(opts: CompositeOptions): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, W, H);

  // Every variant gets photo top + variant-specific bottom panel when image available
  // (matches reference IG style — no slide is pure black with text).
  // text_explainer handles its own photo internally.
  const variant = opts.slide.layout_variant;
  if (variant !== "text_explainer" && opts.attachedImage) {
    await drawPhotoTopHalf(ctx, opts.attachedImage);
  }
  switch (variant) {
    case "stat_card":
      drawStatCard(ctx, opts);
      break;
    case "quote_pull":
      drawQuotePull(ctx, opts);
      break;
    case "list_card":
      drawListCard(ctx, opts);
      break;
    case "text_explainer":
    default:
      await drawTextExplainer(ctx, opts);
      break;
  }

  drawCorners(ctx, opts);
  return canvas.toBuffer("image/png");
}

async function drawTextExplainer(ctx: SKRSContext2D, opts: CompositeOptions): Promise<void> {
  const { slide, attachedImage } = opts;
  const text = slide.body_text;
  const headline = slide.headline.toUpperCase();
  const highlights = slide.highlight_phrases.map((p) => p.toUpperCase());
  const emphasis = slide.body_emphasis_phrases ?? [];
  const isProductScreenshot = !!slide.product_screenshot_query && !!attachedImage;

  // No image available → use full-bleed black with text vertically centered (no awkward empty zone)
  if (!attachedImage && !isProductScreenshot) {
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "top";

    // Vertically center: estimate total content height first
    const maxW = W - PAD * 2;
    let titleSize = 64;
    let titleLines: string[] = [];
    for (; titleSize >= 36; titleSize -= 2) {
      ctx.font = `900 ${titleSize}px ${FONT_SANS}`;
      titleLines = wrapLines(ctx, headline, maxW);
      const titleH = titleLines.length * titleSize * 1.1;
      if (titleH <= H * 0.35) break;
    }
    const titleLineH = titleSize * 1.1;
    const titleH = titleLines.length * titleLineH;
    const bodyFontSize = 32;
    const bodyLineH = 42;
    // Rough body line count
    ctx.font = `500 ${bodyFontSize}px ${FONT_SANS}`;
    const bodyLineCount = wrapLines(ctx, text, maxW).length;
    const bodyH = bodyLineCount * bodyLineH;
    const totalH = titleH + 40 + bodyH;
    const startY = Math.max(PAD, (H - totalH) / 2);

    ctx.font = `900 ${titleSize}px ${FONT_SANS}`;
    for (let i = 0; i < titleLines.length; i += 1) {
      const line = titleLines[i];
      if (!line) continue;
      drawHighlightedHeadlineLine(ctx, line, highlights, PAD, startY + i * titleLineH, titleSize);
    }
    drawEmphasizedParagraph(ctx, text, emphasis, PAD, startY + titleH + 40, maxW, bodyFontSize, bodyLineH);
    return;
  }

  // @getintoai DNA (May 2026): body slides are TEXT TOP + IMAGE BOTTOM.
  // Inverse of old layout (photo top, panel bottom). Matches reference style:
  // - Top ~55%: black panel with title + body prose (body in MIXED CASE, not uppercase)
  // - Bottom ~45%: full-bleed photo OR product screenshot
  const TEXT_H = Math.round(H * 0.55);
  const PHOTO_H = H - TEXT_H;
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, 0, W, TEXT_H);

  if (isProductScreenshot && attachedImage) {
    // Bottom: centered product UI screenshot on black with rounded corners + shadow
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, TEXT_H, W, PHOTO_H);
    const innerW = W - PAD * 2;
    const innerH = PHOTO_H - PAD;
    const buf = await sharp(attachedImage)
      .resize(Math.round(innerW * 1.3), Math.round(innerH * 1.3), { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    const img: Image = await loadImage(buf);
    const ratio = Math.min(innerW / img.width, innerH / img.height);
    const dw = img.width * ratio;
    const dh = img.height * ratio;
    const dx = (W - dw) / 2;
    const dy = TEXT_H + (PHOTO_H - dh) / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    roundedRect(ctx, dx, dy, dw, dh, 24);
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundedRect(ctx, dx, dy, dw, dh, 24);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } else if (attachedImage) {
    // Bottom: full-bleed contextual photo (varies per slide).
    const padded = await sharp(attachedImage)
      .resize(W, PHOTO_H, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    const img: Image = await loadImage(padded);
    ctx.drawImage(img, 0, TEXT_H, W, PHOTO_H);
    // Bridge gradient from black panel into photo for clean transition
    const bridge = ctx.createLinearGradient(0, TEXT_H - 20, 0, TEXT_H + 80);
    bridge.addColorStop(0, "rgba(0,0,0,1)");
    bridge.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bridge;
    ctx.fillRect(0, TEXT_H - 20, W, 100);
  }

  // ── Top text region ──
  const panelTop = PAD + 12;
  ctx.textBaseline = "top";

  // Headline (ALL CAPS, condensed bold, Anton)
  let titleSize = 56;
  let titleLines: string[] = [];
  let titleLineH = 0;
  for (; titleSize >= 32; titleSize -= 2) {
    ctx.font = `900 ${titleSize}px ${FONT_SANS}`;
    titleLines = wrapLines(ctx, headline, W - PAD * 2);
    titleLineH = titleSize * 1.05;
    if (titleLines.length * titleLineH <= 200) break;
  }
  for (let i = 0; i < titleLines.length; i += 1) {
    const line = titleLines[i];
    if (!line) continue;
    drawHighlightedHeadlineLine(ctx, line, highlights, PAD, panelTop + i * titleLineH, titleSize);
  }
  const titleEnd = panelTop + titleLines.length * titleLineH + 28;

  // Body paragraph — MIXED CASE per @getintoai reference (not uppercase)
  ctx.fillStyle = WHITE;
  ctx.textAlign = "left";
  drawEmphasizedParagraph(ctx, text, emphasis, PAD, titleEnd, W - PAD * 2, 30, 40);
}

function drawEmphasizedParagraph(
  ctx: SKRSContext2D,
  text: string,
  emphasis: string[],
  x: number,
  y: number,
  maxW: number,
  fontSize: number,
  lineH: number
): void {
  // Build segments alternating regular / bold based on emphasis matches
  const lower = text.toLowerCase();
  const ranges: { start: number; end: number }[] = [];
  for (const phrase of emphasis) {
    if (!phrase) continue;
    let from = 0;
    const p = phrase.toLowerCase();
    while (true) {
      const i = lower.indexOf(p, from);
      if (i === -1) break;
      ranges.push({ start: i, end: i + p.length });
      from = i + p.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  // Merge overlaps
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }

  const segments: { text: string; bold: boolean }[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) segments.push({ text: text.slice(cursor, r.start), bold: false });
    segments.push({ text: text.slice(r.start, r.end), bold: true });
    cursor = r.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), bold: false });

  // Word-wrap honoring segment boundaries
  const tokens: { word: string; bold: boolean }[] = [];
  for (const seg of segments) {
    const words = seg.text.split(/(\s+)/).filter((w) => w.length > 0);
    for (const w of words) tokens.push({ word: w, bold: seg.bold });
  }

  let curY = y;
  let line: { word: string; bold: boolean }[] = [];
  const measure = (tok: { word: string; bold: boolean }) => {
    ctx.font = `${tok.bold ? 700 : 500} ${fontSize}px ${FONT_SANS}`;
    return ctx.measureText(tok.word).width;
  };
  let lineW = 0;
  for (const tok of tokens) {
    const w = measure(tok);
    if (lineW + w > maxW && tok.word.trim().length > 0) {
      drawLine(ctx, line, x, curY, fontSize);
      line = [];
      lineW = 0;
      curY += lineH;
      if (tok.word.trim().length === 0) continue;
    }
    line.push(tok);
    lineW += w;
  }
  if (line.length) drawLine(ctx, line, x, curY, fontSize);
}

function drawLine(ctx: SKRSContext2D, line: { word: string; bold: boolean }[], x: number, y: number, fontSize: number): void {
  let cx = x;
  for (const tok of line) {
    ctx.font = `${tok.bold ? 700 : 500} ${fontSize}px ${FONT_SANS}`;
    ctx.fillStyle = WHITE;
    ctx.fillText(tok.word, cx, y);
    cx += ctx.measureText(tok.word).width;
  }
}

function drawHighlightedHeadlineLine(
  ctx: SKRSContext2D,
  line: string,
  highlights: string[],
  startX: number,
  y: number,
  fontSize: number
): void {
  ctx.font = `900 ${fontSize}px ${FONT_SANS}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let x = startX;
  const words = line.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!word) continue;
    const isLast = i === words.length - 1;
    const drawn = isLast ? word : `${word} `;
    const isHL = highlights.some((h) => {
      const w = word.replace(/[^A-Z0-9$%]/g, "");
      return h.split(" ").some((hw) => hw.replace(/[^A-Z0-9$%]/g, "") === w);
    });
    ctx.fillStyle = isHL ? PURPLE() : WHITE;
    ctx.fillText(drawn, x, y);
    x += ctx.measureText(drawn).width;
  }
}

// Shared: draw full-bleed photo on top 50%, black panel bottom 50%.
// Variants render their content into the bottom panel by adjusting Y math.
async function drawPhotoTopHalf(ctx: SKRSContext2D, imageBuf: Buffer): Promise<void> {
  const PHOTO_H = Math.round(H * 0.5);
  const padded = await sharp(imageBuf)
    .resize(W, PHOTO_H, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const img: Image = await loadImage(padded);
  ctx.drawImage(img, 0, 0, W, PHOTO_H);
  // Black bottom panel
  ctx.fillStyle = BLACK;
  ctx.fillRect(0, PHOTO_H, W, H - PHOTO_H);
  // Bridge gradient over the seam for cleaner transition
  const bridge = ctx.createLinearGradient(0, PHOTO_H - 60, 0, PHOTO_H + 20);
  bridge.addColorStop(0, "rgba(0,0,0,0)");
  bridge.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = bridge;
  ctx.fillRect(0, PHOTO_H - 60, W, 80);
}

function drawStatCard(ctx: SKRSContext2D, opts: CompositeOptions): void {
  const stat = (opts.slide.stat_value ?? opts.slide.headline).toUpperCase();
  const caption = opts.slide.stat_caption ?? opts.slide.body_text;
  // If photo on top, fit stat into bottom panel (50%-90%); else center full frame.
  const hasPhoto = !!opts.attachedImage;
  const panelTop = hasPhoto ? Math.round(H * 0.5) : 0;
  const panelH = H - panelTop;
  const cy = panelTop + panelH * 0.4;

  // Detect number portion vs unit
  const m = stat.match(/^([$£€]?[\d.,]+[KMB]?%?)(.*)$/);
  const numPart: string = m?.[1] ?? stat;
  const unitPart: string = (m?.[2] ?? "").trim();
  const fullText = unitPart ? `${numPart} ${unitPart}` : numPart;

  const maxW = W - PAD * 2;
  // Auto-fit: smaller start size when photo eats top half. Shrink until fits.
  const startSize = hasPhoto ? 180 : 360;
  let fontSize = startSize;
  for (; fontSize >= 60; fontSize -= 8) {
    ctx.font = `${fontSize}px ${FONT_DISPLAY}`;
    if (ctx.measureText(fullText).width <= maxW) break;
  }

  // If single line still doesn't fit, wrap the stat itself
  ctx.font = `${fontSize}px ${FONT_DISPLAY}`;
  const fits = ctx.measureText(fullText).width <= maxW;
  ctx.textBaseline = "middle";

  if (fits) {
    const numWidth = ctx.measureText(numPart).width;
    const unitWidth = unitPart ? ctx.measureText(` ${unitPart}`).width : 0;
    const total = numWidth + unitWidth;
    const startX = W / 2 - total / 2;
    ctx.fillStyle = PURPLE();
    ctx.textAlign = "left";
    ctx.fillText(numPart, startX, cy);
    if (unitPart) {
      ctx.fillStyle = WHITE;
      ctx.fillText(` ${unitPart}`, startX + numWidth, cy);
    }
  } else {
    // Fallback: wrap stat in 2 lines, centered, all white (no purple split)
    ctx.fillStyle = WHITE;
    ctx.textAlign = "center";
    const lines = wrapLines(ctx, fullText, maxW);
    const lineH = fontSize * 1.05;
    const startY = cy - ((lines.length - 1) * lineH) / 2;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line) ctx.fillText(line, W / 2, startY + i * lineH);
    }
  }

  ctx.textAlign = "center";
  ctx.fillStyle = WHITE;
  ctx.font = `500 ${hasPhoto ? 28 : 38}px ${FONT_SANS}`;
  ctx.textBaseline = "alphabetic";
  const captionGap = hasPhoto ? Math.min(140, fontSize * 0.7 + 20) : 220;
  wrapText(ctx, caption, PAD, cy + captionGap, W - PAD * 2, hasPhoto ? 36 : 48, true, "center");
}

function drawQuotePull(ctx: SKRSContext2D, opts: CompositeOptions): void {
  const q = opts.slide.pull_quote ?? opts.slide.body_text;
  const attr = (opts.slide.quote_attribution ?? "").toUpperCase();
  const hasPhoto = !!opts.attachedImage;
  const panelTop = hasPhoto ? Math.round(H * 0.5) : 0;
  const quoteStartY = hasPhoto ? panelTop + 40 : H * 0.32;
  const quoteFontSize = hasPhoto ? 40 : 64;
  const quoteLineH = hasPhoto ? 52 : 80;

  // Giant decorative quote mark (only when no photo — would clash with image)
  if (!hasPhoto) {
    ctx.fillStyle = PURPLE();
    ctx.globalAlpha = 0.25;
    ctx.font = `900 480px ${FONT_SERIF}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("“", PAD - 30, PAD - 60);
    ctx.globalAlpha = 1;
  }

  // Quote body
  ctx.fillStyle = WHITE;
  ctx.font = `600 ${quoteFontSize}px ${FONT_SERIF}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const qLines = wrapText(ctx, `“${q}”`, PAD, quoteStartY, W - PAD * 2, quoteLineH);
  const qEnd = quoteStartY + qLines * quoteLineH;

  if (attr) {
    ctx.fillStyle = DIM;
    ctx.textAlign = "left";
    // Auto-fit + wrap. Attribution can be long (full name + title + source). Shrink until fits, then wrap.
    const maxW = W - PAD * 2;
    let fontSize = 24;
    for (; fontSize >= 16; fontSize -= 2) {
      ctx.font = `700 ${fontSize}px ${FONT_MONO}`;
      if (ctx.measureText(attr).width <= maxW) break;
    }
    ctx.font = `700 ${fontSize}px ${FONT_MONO}`;
    if (ctx.measureText(attr).width <= maxW) {
      ctx.fillText(attr, PAD, qEnd + 40);
    } else {
      // Still overflowing → wrap to 2 lines
      wrapText(ctx, attr, PAD, qEnd + 40, maxW, fontSize + 6);
    }
  }
}

function drawListCard(ctx: SKRSContext2D, opts: CompositeOptions): void {
  const items = opts.slide.list_items ?? [];
  const title = (opts.slide.list_title ?? opts.slide.headline).toUpperCase();
  const hasPhoto = !!opts.attachedImage;
  const panelTop = hasPhoto ? Math.round(H * 0.5) : 0;
  const titleY = hasPhoto ? panelTop + 24 : PAD;
  const titleSize = hasPhoto ? 48 : 78;
  const titleLineH = hasPhoto ? 52 : 84;
  const itemFontSize = hasPhoto ? 26 : 38;
  const itemLineH = hasPhoto ? 36 : 50;
  const itemGap = hasPhoto ? 18 : 36;

  ctx.fillStyle = PURPLE();
  ctx.font = `${titleSize}px ${FONT_DISPLAY}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const titleLines = wrapText(ctx, title, PAD, titleY, W - PAD * 2, titleLineH);

  let y = titleY + titleLines * titleLineH + 24;
  ctx.font = `500 ${itemFontSize}px ${FONT_SANS}`;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    ctx.fillStyle = PURPLE();
    ctx.fillText(`${String(i + 1).padStart(2, "0")}.`, PAD, y);
    ctx.fillStyle = WHITE;
    const lines = wrapText(ctx, item, PAD + (hasPhoto ? 70 : 100), y, W - PAD * 2 - (hasPhoto ? 70 : 100), itemLineH);
    y += lines * itemLineH + itemGap;
  }
}

function drawCorners(ctx: SKRSContext2D, opts: CompositeOptions): void {
  ctx.font = `600 22px ${FONT_MONO}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = PURPLE();
  ctx.textAlign = "right";
  ctx.fillText(`${String(opts.slide.slide_number).padStart(2, "0")} / ${String(opts.total).padStart(2, "0")}`, W - PAD, H - 48);
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  draw = true,
  align: "left" | "center" = "left"
): number {
  const words = text.split(/\s+/);
  let line = "";
  let curY = y;
  let lines = 0;
  const prevAlign = ctx.textAlign;
  if (draw) ctx.textAlign = align;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    const m = ctx.measureText(test);
    if (m.width > maxW && line) {
      if (draw) ctx.fillText(line, align === "center" ? x + maxW / 2 : x, curY);
      line = word;
      curY += lineH;
      lines += 1;
    } else {
      line = test;
    }
  }
  if (line) {
    if (draw) ctx.fillText(line, align === "center" ? x + maxW / 2 : x, curY);
    lines += 1;
  }
  if (draw) ctx.textAlign = prevAlign;
  return lines;
}

export async function writeComposite(buf: Buffer, dest: string): Promise<void> {
  await writeFile(dest, buf);
}

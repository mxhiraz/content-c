// Image generation prompts moved to prompts/render/*.md.
// Each builder pre-computes conditional bits (e.g. highlight line, top region)
// then fills the template via skills loader.

import { skills } from "../skills/loader.js";
import type { BodySlide, HookSlide } from "../types.js";

function quote(phrases: readonly string[]): string {
  return phrases.map((p) => `"${p.toUpperCase()}"`).join(" + ");
}

export function buildHookPrompt(spec: HookSlide, _brandHandle: string, highlightHex: string): string {
  const stylePreamble = skills.render.style({ highlightHex });
  const headline = spec.headline.toUpperCase();
  const subTag = spec.sub_tagline.toUpperCase();
  return skills.render.hook({
    stylePreamble,
    headline,
    subTag,
    highlightHex,
    highlightedWords: quote(spec.highlight_phrases),
    subjectPhotoQuery: spec.subject_photo_query,
    backgroundScene: spec.background_scene || "a contextually relevant scene tied to the headline (e.g. trading floor, conference stage, studio, courtroom, server room) — never a generic concrete wall",
    overlayConcept: spec.overlay_concept,
  });
}

export function buildBodyPrompt(slide: BodySlide, brandHandle: string, highlightHex: string): string {
  switch (slide.layout_variant) {
    case "stat_card":
      return buildStatCard(slide, brandHandle, highlightHex);
    case "quote_pull":
      return buildQuotePull(slide, brandHandle, highlightHex);
    case "list_card":
      return buildListCard(slide, brandHandle, highlightHex);
    case "text_explainer":
    default:
      return buildTextExplainer(slide, brandHandle, highlightHex);
  }
}

function buildListCard(slide: BodySlide, _brandHandle: string, highlightHex: string): string {
  const stylePreamble = skills.render.style({ highlightHex });
  const title = (slide.list_title ?? slide.headline).toUpperCase();
  const items = slide.list_items ?? [];
  const itemLines = items.map((it, i) => `${String(i + 1).padStart(2, "0")}. ${it}`).join("\n");
  return skills.render.bodyListCard({
    stylePreamble,
    title,
    itemLines,
    highlightHex,
    slideNumber: slide.slide_number,
  });
}

function buildTextExplainer(slide: BodySlide, _brandHandle: string, highlightHex: string): string {
  const stylePreamble = skills.render.style({ highlightHex });
  const headline = slide.headline.toUpperCase();
  const bodyParagraph = slide.body_text;
  const highlightLine = slide.highlight_phrases.length
    ? `Within the headline, the words ${quote(slide.highlight_phrases)} are in solid ${highlightHex} (every other word stays white). Render the hex EXACTLY (do NOT default to purple/magenta).`
    : "All headline words are white.";
  const emphasis = slide.body_emphasis_phrases ?? [];
  const emphasisLine = emphasis.length
    ? `Within the body paragraph, render these specific phrases in BOLD WEIGHT (700) while keeping the surrounding text at regular weight (500), all white: ${emphasis.map((e) => `"${e}"`).join(", ")}. Do NOT color the bold phrases; bold weight only.`
    : `Body paragraph is uniformly regular weight, no bold runs.`;
  const isProductScreenshot = !!slide.product_screenshot_query;
  const topRegion = isProductScreenshot
    ? `- The TOP half is solid black. Inset the reference image labeled PRODUCT_SCREENSHOT as a CENTERED product UI mockup with rounded corners (~24-28px), generous outer drop shadow (40px blur, 18px offset, 60% opacity black). Leave clear black margin on all four sides. Preserve every pixel of the screenshot; do NOT redraw, recolor, or stylize the UI. Do NOT crop to full-bleed.`
    : `- Full-bleed photoreal image fitting: ${slide.supporting_visual_concept}. Cinematic editorial lighting, real-world materials. NO illustration, NO 3D render. Slight bottom vignette where it meets the black panel.`;

  return skills.render.bodyTextExplainer({
    stylePreamble,
    headline,
    bodyParagraph,
    highlightHex,
    highlightLine,
    emphasisLine,
    topRegion,
    slideNumber: slide.slide_number,
  });
}

function buildStatCard(slide: BodySlide, _brandHandle: string, highlightHex: string): string {
  const stylePreamble = skills.render.style({ highlightHex });
  const stat = (slide.stat_value ?? slide.headline).toUpperCase();
  const caption = slide.stat_caption ?? slide.body_text;
  return skills.render.bodyStatCard({
    stylePreamble,
    stat,
    caption,
    highlightHex,
    slideNumber: slide.slide_number,
  });
}

function buildQuotePull(slide: BodySlide, _brandHandle: string, highlightHex: string): string {
  const stylePreamble = skills.render.style({ highlightHex });
  const q = slide.pull_quote ?? slide.body_text;
  const attr = (slide.quote_attribution ?? "").toUpperCase();
  return skills.render.bodyQuotePull({
    stylePreamble,
    quote: q,
    attribution: attr,
    highlightHex,
    slideNumber: slide.slide_number,
  });
}

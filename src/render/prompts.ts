import type { BodySlide, HookSlide } from "../types.js";

const STYLE = (highlightHex: string) => `Aesthetic: viral AI/tech news Instagram (@unfoldedai / @aipagedaily). Photoreal editorial photography. Single accent color ${highlightHex} used ONLY for word-level highlights and small sub-taglines. Render the accent color EXACTLY as the hex specified (do NOT default to purple, magenta, or any other color regardless of training bias). Solid pure black panels for explainer/stat/quote variants.
Typography: heavy bold condensed sans-serif (Druk Wide, Tungsten, Anton, Akzidenz Grotesk Black) for headlines. Clean medium-weight humanist sans-serif (Inter, Söhne, Helvetica Now) for explainer paragraphs. Tight tracking. ALL-CAPS only where the SPECIFIED TEXT block is uppercase. Small monospace for corner metadata.

ANTI-AI REALISM (this is the hardest constraint): The subject MUST look like a real DSLR photograph from a magazine. NOT AI-generated. NO smooth plastic skin, NO uncanny symmetric faces, NO airbrushed glow, NO rendered hands with wrong fingers, NO over-saturated cinematic-LUT look. Skin must show real pores, micro-stubble, blemishes. Hair has flyaways. Fabric shows weave. Lighting has real falloff. If unsure, lean toward documentary photojournalism realism, NOT cinematic CGI.

Crisp print kerning. No spelling mistakes. No hallucinated extra letters. Render every word in the SPECIFIED TEXT below exactly: do not paraphrase, do not abbreviate. NO Instagram UI, no like/comment icons, no fake usernames, no swipe arrows unless explicitly requested.
HARD RULE: NEVER render an em dash (—) or en dash (–). Use periods, commas, colons, or hyphens (-) only.`;

function quote(phrases: readonly string[]): string {
  return phrases.map((p) => `"${p.toUpperCase()}"`).join(" + ");
}

export function buildHookPrompt(spec: HookSlide, brandHandle: string, highlightHex: string): string {
  const headline = spec.headline.toUpperCase();
  const subTag = spec.sub_tagline.toUpperCase();
  return `${STYLE(highlightHex)}

REFERENCE STYLE: a viral AI/tech news Instagram cover. Photoreal portrait foreground, recognizable brand logos floating beside the subject, gritty dark textured wall behind, massive bold uppercase headline overlaid directly on the lower half of the photo (NO separate black panel), word-level ${highlightHex} highlights, small ${highlightHex} sub-tagline beneath the headline.

CANVAS: 4:5 portrait. Full-bleed PHOTO, no black panels, no borders.

PHOTO LAYER:
- Subject: USE THE REFERENCE IMAGE labeled SUBJECT_PHOTO as the ground truth for the subject's face. Preserve identity, skin tone, facial features, expression. Match the SAME PERSON from the reference; do NOT generate a generic stand-in. Re-light to cinematic editorial: soft key light from upper-left, gentle rim light, subtle vignette. Skin shows real texture and pores. Photoreal, NOT illustrated, NOT stylized, NOT 3D-rendered.
- If no SUBJECT_PHOTO reference is provided, generate a photoreal portrait matching this brief: ${spec.subject_photo_query}.
- Frame chest-up to mid-torso, subject looking confidently at camera.
- BACKGROUND (this is critical for relevance): re-place the subject INTO this specific scene tied to the story: "${spec.background_scene || "a contextually relevant scene tied to the headline (e.g. trading floor, conference stage, studio, courtroom, server room) — never a generic concrete wall"}". The background must visually telegraph the news. Use shallow depth-of-field so the subject stays sharp and the scene is softly blurred. Lighting on the subject must match the scene's lighting direction (warm tungsten for a studio, cold blue for a server room, golden-hour for an outdoor terrace, etc.).
- Floating beside the subject: render EXACTLY the number of LOGO_* reference images that were provided as inputs. NO MORE, NO LESS. Do NOT duplicate any logo. Do NOT invent extra logos for symmetry. Do NOT add a logo that was not provided as a reference. Use each provided LOGO bitmap VERBATIM (do not redraw, do not recolor, do not stylize). If 0 logos were provided, omit the floating-logos element entirely. If 1 logo was provided, place it on the right side of the subject, sized large but not covering the face. If 2 logos were provided, place one on the left and one on the right. If 3 logos were provided, place 2 on the left and 1 on the right (or 1+2). Logos sit AT or BEHIND the subject's shoulder line with a slight drop shadow, never in front of the face. Concept hint (do NOT use this to invent additional logos): ${spec.overlay_concept}.

HEADLINE BLOCK (lower 45% of canvas, overlaid directly on the photo with no panel: text must stay legible via natural photo darkness, NOT via a solid black box):
- Render this exact headline, ALL CAPS, in heavy bold condensed sans-serif (Druk Wide / Anton style), white, broken naturally across 4-6 lines, centered, tight line-height:
  "${headline}"
- WITHIN that headline, render the words ${quote(spec.highlight_phrases)} in solid ${highlightHex} (every other word stays white). The highlight color is opaque, not faded. Do not paraphrase or skip any word.

SUB-TAGLINE (centered, directly below the headline, much smaller, condensed bold ALL-CAPS in ${highlightHex}, ~16% of headline size):
${subTag}

SWIPE INDICATOR (centered, near the very bottom edge, small white monospace, weight 700, ~20pt):
SWIPE FOR MORE  →

NEGATIVE (the ONLY text allowed in the entire image is the headline + sub-tagline, exactly as specified. ALL other text is forbidden):
- NO wordmark text. NEVER spell out a company name as text (e.g. NEVER render "ANTHROPIC", "OPENAI", "META", "GOOGLE" as standalone letters). The ONLY brand presence allowed is the LOGO_* reference image bitmap composited verbatim. If no logo reference exists for an entity, do NOT render its name as text.
- NO made-up letters, NO partial wordmarks, NO weird letter substitutions like "ANTHROP\\C" or "OPEN A1".
- NO fake metadata text along any edge of the image: no "Media", no "Mar 09 2024", no "13:30 PST", no fake author bylines, no fake city names, no fake camera EXIF strings, no fake captions, no fake timestamps. The top, bottom, left, and right edges must be CLEAN of any small text other than what is explicitly specified.
- NO ticker, NO scrolling chyron, NO mini headlines along the top edge.
- NO brand handle, NO @username text, NO social handle anywhere on the canvas.
- NO Instagram UI, no like/comment/share icons, no fake usernames, no random magazine cover lines, no barcode, no date stamp, no swipe arrow, no extra body copy, no decorative quotes, no flat solid black panel under the headline.
- NO generic concrete-wall backgrounds (the same background every cover ruins the brand). Use the BACKGROUND scene specified above.
- Subject must NOT be cartoon, anime, illustrated, or 3D-rendered: must be a real photographic portrait of the SAME person from the SUBJECT_PHOTO reference.`;
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

function buildListCard(slide: BodySlide, brandHandle: string, highlightHex: string): string {
  const title = (slide.list_title ?? slide.headline).toUpperCase();
  const items = slide.list_items ?? [];
  const itemLines = items.map((it, i) => `${String(i + 1).padStart(2, "0")}. ${it}`).join("\n");
  return `${STYLE(highlightHex)}

LAYOUT: numbered-list slide, 4:5 portrait, solid pure black background.

TITLE (top, left-aligned, heavy condensed sans-serif white, ALL CAPS, 2 lines max, ~64pt):
${title}

LIST (left-aligned, generous line-height, each item on its own line):
- Number prefix in ${highlightHex} (e.g. "01.", "02.") followed by item text in white sans-serif mixed-case medium weight, ~38pt.
- Render verbatim:
${itemLines}

CORNER:
- Bottom-right, small monospace, ${highlightHex}: ${slide.slide_number} / -

NEGATIVE: no brand handle, no @username, no extra text, no bullets/dashes (numbers only), no Instagram UI, no decorative graphics, no gradient. Background must be pure black.`;
}

function buildTextExplainer(slide: BodySlide, brandHandle: string, highlightHex: string): string {
  const headline = slide.headline.toUpperCase();
  const para = slide.body_text;
  const highlightLine = slide.highlight_phrases.length
    ? `Within the headline, the words ${quote(slide.highlight_phrases)} are in solid ${highlightHex} (every other word stays white). Render the hex EXACTLY (do NOT default to purple/magenta).`
    : "All headline words are white.";
  const emphasis = slide.body_emphasis_phrases ?? [];
  const emphasisLine = emphasis.length
    ? `Within the body paragraph, render these specific phrases in BOLD WEIGHT (700) while keeping the surrounding text at regular weight (500), all white: ${emphasis.map((e) => `"${e}"`).join(", ")}. Do NOT color the bold phrases; bold weight only.`
    : `Body paragraph is uniformly regular weight, no bold runs.`;
  const isProductScreenshot = !!slide.product_screenshot_query;

  return `${STYLE(highlightHex)}

LAYOUT: text-explainer slide, 4:5 portrait. TWO REGIONS:
- TOP HALF (50% of canvas): visual zone (BLACK background; image is either a centered product UI mockup OR a full-bleed editorial photo).
- BOTTOM HALF (50% of canvas): solid pure black panel holding the title + body paragraph.

TOP REGION
${isProductScreenshot ? `- The TOP half is solid black. Inset the reference image labeled PRODUCT_SCREENSHOT as a CENTERED product UI mockup with rounded corners (~24-28px), generous outer drop shadow (40px blur, 18px offset, 60% opacity black). Leave clear black margin on all four sides. Preserve every pixel of the screenshot; do NOT redraw, recolor, or stylize the UI. Do NOT crop to full-bleed.` : `- Full-bleed photoreal image fitting: ${slide.supporting_visual_concept}. Cinematic editorial lighting, real-world materials. NO illustration, NO 3D render. Slight bottom vignette where it meets the black panel.`}

BOTTOM REGION (black panel, generous left padding ~72px)
1) HEADLINE (render VERBATIM, ALL CAPS, heavy bold condensed sans-serif (Druk Wide / Anton), ~46-56pt, broken across 2-3 lines, left-aligned):
   "${headline}"
   ${highlightLine}

2) BODY PARAGRAPH (directly below headline, white, mixed case, humanist sans-serif (Inter / Söhne), ~28pt, line-height ~1.25, max 4 lines):
   "${para}"
   ${emphasisLine}

CORNER:
- Bottom-right: small monospace, ${highlightHex}: ${slide.slide_number} / -

NEGATIVE: NO side arrows, NO pagination chevrons, NO left/right circle nav buttons, NO swipe-arrow circles. NO brand handle, NO @username, NO "First Edition" pill, NO decorative emojis, NO Instagram UI, NO fake usernames, NO swipe arrow text. NO em dashes (use periods/commas/colons/hyphens). The bottom panel must be pure pixel-perfect black.`;
}

function buildStatCard(slide: BodySlide, brandHandle: string, highlightHex: string): string {
  const stat = (slide.stat_value ?? slide.headline).toUpperCase();
  const caption = slide.stat_caption ?? slide.body_text;
  return `${STYLE(highlightHex)}

LAYOUT: stat-card slide, 4:5 portrait, solid pure black background.

CENTER STAT:
- Render the following stat VERBATIM, centered, massive heavy condensed sans-serif (Druk Wide / Anton style), white, ~280-360pt:
  "${stat}"
- If the stat contains a number followed by a unit (e.g. "10M USERS", "$50B"), color the number portion in ${highlightHex} and keep the unit white. Otherwise color the most surprising word in ${highlightHex}.

CAPTION (directly below the stat, centered, much smaller):
- Render this caption verbatim in mixed-case medium-weight white sans-serif, ~28-34pt, max 2 lines:
  "${caption}"

CORNER:
- Bottom-right: small monospace, ${highlightHex}: ${slide.slide_number} / -

NEGATIVE: no brand handle, no @username, no other text, no decorative graphics, no Instagram UI, no gradient. Background must be pure black.`;
}

function buildQuotePull(slide: BodySlide, brandHandle: string, highlightHex: string): string {
  const q = slide.pull_quote ?? slide.body_text;
  const attr = slide.quote_attribution ?? "";
  return `${STYLE(highlightHex)}

LAYOUT: pull-quote slide, 4:5 portrait, solid pure black background.

GIANT QUOTE MARK (top-left of the canvas, ${highlightHex}, semi-transparent ~35%, very large condensed serif "“", purely decorative).

QUOTE BODY (centered, white, condensed serif/semi-serif (e.g. Tiempos Headline / GT Sectra) at ~64-80pt, mixed case, line-height ~1.1):
- Render this quote VERBATIM, in actual quotation marks, broken across 3-5 lines:
  "${q}"
- Highlight the single most striking 2-4 word phrase inside the quote in ${highlightHex}; keep the rest white.

ATTRIBUTION (below the quote, centered, small white sans-serif uppercase, letter-spaced):
- Render verbatim:
  "${attr.toUpperCase()}"

CORNER:
- Bottom-right: small monospace, ${highlightHex}: ${slide.slide_number} / -

NEGATIVE: no brand handle, no @username, no other text, no photo, no decorative graphics beyond the giant quote mark, no Instagram UI, no gradient. Background must be pure black.`;
}


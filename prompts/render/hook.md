{{stylePreamble}}

REFERENCE STYLE: a viral AI/tech news Instagram cover. Photoreal portrait foreground, recognizable brand logos floating beside the subject, gritty dark textured wall behind, massive bold uppercase headline overlaid directly on the lower half of the photo (NO separate black panel), word-level {{highlightHex}} highlights, small {{highlightHex}} sub-tagline beneath the headline.

CANVAS: 4:5 portrait. Full-bleed PHOTO, no black panels, no borders.

PHOTO LAYER:
- Subject: USE THE REFERENCE IMAGE labeled SUBJECT_PHOTO as the ground truth for the subject's face. Preserve identity, skin tone, facial features, expression. Match the SAME PERSON from the reference; do NOT generate a generic stand-in. Re-light to cinematic editorial: soft key light from upper-left, gentle rim light, subtle vignette. Skin shows real texture and pores. Photoreal, NOT illustrated, NOT stylized, NOT 3D-rendered.
- If no SUBJECT_PHOTO reference is provided, generate a photoreal portrait matching this brief: {{subjectPhotoQuery}}.
- Frame chest-up to mid-torso, subject looking confidently at camera.
- BACKGROUND (this is critical for relevance): re-place the subject INTO this specific scene tied to the story: "{{backgroundScene}}". The background must visually telegraph the news. Use shallow depth-of-field so the subject stays sharp and the scene is softly blurred. Lighting on the subject must match the scene's lighting direction (warm tungsten for a studio, cold blue for a server room, golden-hour for an outdoor terrace, etc.).
- Floating beside the subject: render EXACTLY the number of LOGO_* reference images that were provided as inputs. NO MORE, NO LESS. Do NOT duplicate any logo. Do NOT invent extra logos for symmetry. Do NOT add a logo that was not provided as a reference. Use each provided LOGO bitmap VERBATIM (do not redraw, do not recolor, do not stylize). If 0 logos were provided, omit the floating-logos element entirely. If 1 logo was provided, place it on the right side of the subject, sized large but not covering the face. If 2 logos were provided, place one on the left and one on the right. If 3 logos were provided, place 2 on the left and 1 on the right (or 1+2). Logos sit AT or BEHIND the subject's shoulder line with a slight drop shadow, never in front of the face. Concept hint (do NOT use this to invent additional logos): {{overlayConcept}}.

HEADLINE BLOCK (lower 45% of canvas, overlaid directly on the photo with no panel: text must stay legible via natural photo darkness, NOT via a solid black box):
- Render this exact headline, ALL CAPS, in heavy bold condensed sans-serif (Druk Wide / Anton style), white, broken naturally across 4-6 lines, centered, tight line-height:
  "{{headline}}"
- WITHIN that headline, render the words {{highlightedWords}} in solid {{highlightHex}} (every other word stays white). The highlight color is opaque, not faded. Do not paraphrase or skip any word.

SUB-TAGLINE (centered, directly below the headline, much smaller, condensed bold ALL-CAPS in {{highlightHex}}, ~16% of headline size):
{{subTag}}

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
- Subject must NOT be cartoon, anime, illustrated, or 3D-rendered: must be a real photographic portrait of the SAME person from the SUBJECT_PHOTO reference.

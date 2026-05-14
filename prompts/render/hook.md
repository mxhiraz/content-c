{{stylePreamble}}

LAYOUT (@getintoai DNA — absorbed from 560-post dataset, May 2026):
- 4:5 portrait canvas. Photoreal full-bleed photo in TOP 60-65% of canvas.
- Solid pure BLACK panel covering BOTTOM 35-40% (hard horizontal cut, no gradient blur into the photo).
- Centered Anton-style condensed bold ALL-CAPS headline filling the black panel, 4-5 lines.
- Small white "SWIPE FOR MORE ▶" chip at the very bottom, centered.

PHOTO LAYER (top 60-65%):
- Subject: USE THE REFERENCE IMAGE labeled SUBJECT_PHOTO as ground truth. Preserve identity, skin tone, expression. Same person. Re-light cinematic editorial: soft key from upper-left, gentle rim, subtle vignette. Real skin texture (pores, micro-stubble). Documentary photojournalism realism. NOT illustrated, NOT 3D-rendered.
- If no SUBJECT_PHOTO is provided, generate a photoreal portrait matching: {{subjectPhotoQuery}}
- Background scene tied to the story: "{{backgroundScene}}". Shallow depth-of-field, subject sharp, scene softly blurred. Lighting on subject matches the scene's lighting direction.
- OPTIONAL circular inset (top-right corner of photo, ~22% width): a smaller related image showing the OTHER side of the story — e.g. a logo bitmap, a related product, a robot, a relevant icon. Use the LOGO_* reference bitmap VERBATIM inside a perfect circle with subtle white outer ring. NO duplicate logos. If 0 logos provided, skip the inset entirely.
- Frame chest-up to mid-torso, subject looking confidently at camera.

BLACK PANEL (bottom 35-40%):
- Solid #000000 panel. Hard top edge (no gradient seam into photo above).
- HEADLINE: render this exact text VERBATIM, ALL CAPS, heavy bold condensed sans-serif (Druk Wide / Tungsten / Anton style), tight kerning, 4-5 lines, centered:
  "{{headline}}"
- WORD-ALTERNATION rule: alternate WHITE and the ACCENT COLOR (defined in preamble) every 1-2 words to create rhythm. Key load-bearing nouns and phrases like {{highlightedWords}} should be in the ACCENT COLOR. The accent is opaque, vivid, never faded. Do not paraphrase, do not skip any word. NEVER render the hex code as visible text — apply it only as a color.
- Vertical fit: scale font so all 4-5 lines fit comfortably in the panel with consistent line-height (~0.95 of font size).

SUB-TAGLINE (one short line directly below the headline, centered, smaller, white sans-serif, ~24pt, sentence case):
{{subTag}}

SWIPE INDICATOR (centered at the very bottom edge, ~40px above edge, small white monospace 18-20pt):
SWIPE FOR MORE ▶

NEGATIVE — the ONLY text allowed in the image is the headline + sub-tagline + "SWIPE FOR MORE ▶". Everything else forbidden:
- NO brand wordmark, NO "GETINTOAI", NO "@username", NO Instagram handle, NO watermark
- NO kicker / hairlines / "—— BRAND ——" decorations
- NO ticker, NO chyron, NO mini-headlines along edges
- NO fake metadata text (dates, locations, EXIF, bylines)
- NO Instagram UI (no like/comment/share icons, no nav arrows, no dots)
- NO em dash (—) or en dash (–). Period, comma, colon, hyphen (-) only.
- NO duplicated logos, NO invented logos beyond the LOGO_* references provided
- NO generic concrete-wall backgrounds — use the specified BACKGROUND scene
- Subject must NOT be cartoon, anime, illustrated, 3D-rendered, or AI-glossy. Must read as a real DSLR photograph.

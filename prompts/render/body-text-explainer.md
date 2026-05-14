{{stylePreamble}}

LAYOUT (@getintoai DNA for body slides — absorbed from 560-post dataset):
Most body slides in the reference are PURE PROSE on solid black, with no Anton headline overlay and no rigid panel split. Clean, readable, scrollable.

CANVAS: 4:5 portrait, solid pure black background (#000000) edge-to-edge.

PRIMARY ZONE (top 55-65% of canvas):
- Mixed-case white prose, humanist sans-serif (Inter / Söhne / Helvetica Now), regular-to-medium weight, ~32-40pt, generous line-height ~1.35.
- Render the body paragraph VERBATIM, broken across 2-4 short paragraphs (insert blank lines between them):
  "{{bodyParagraph}}"
- {{emphasisLine}}
- Optional small headline above the prose if the slide has one. If included: ALL CAPS, condensed bold sans-serif (Anton / Druk Wide), white, ~46-56pt, 2 lines max, left-aligned. Render verbatim:
  "{{headline}}"
  {{highlightLine}}
- Generous left padding (~80px) — text starts left-aligned, NOT centered.

VISUAL ZONE (bottom 35-45% of canvas):
{{topRegion}}

- Soft top-edge darkening (~50px gradient) so the photo blends into the black panel above with no hard seam.

CORNER METADATA: bottom-right corner of canvas. Render the EXACT text below in small monospace 16pt, colored in the ACCENT COLOR defined in the preamble. DO NOT render the hex code as text. Render only this:
{{slideNumber}} / -

NEGATIVE — only the prose + optional headline + corner metadata allowed. Forbidden:
- NO brand wordmark, NO Instagram handle, NO watermark, NO "GETINTOAI"
- NO Instagram UI (no like/comment icons, no swipe arrows, no left/right nav arrows, no dot pagination)
- NO em dash (—) or en dash (–). Period, comma, colon, hyphen only.
- NO ticker, NO chyron, NO fake metadata along edges
- NO captions burned into the bottom photo. The photo carries no text.
- NO cartoon, anime, illustrated, 3D-rendered subjects. Documentary photoreal only.

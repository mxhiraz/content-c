{{stylePreamble}}

LAYOUT: numbered-list slide, 4:5 portrait. Matches @getintoai DNA — split composition:
- TOP HALF (~55%): solid black panel with title + numbered list (mixed-case items)
- BOTTOM HALF (~45%): full-bleed contextual illustration or photoreal scene tied to the list topic

TOP REGION (black panel, generous left padding)
- Title (top, left-aligned, heavy condensed sans-serif, white, ALL CAPS, ~42-50pt, 2 lines max):
  "{{title}}"
- Numbered list (left-aligned, generous line-height, each item on its own line, mixed-case):
  - Number prefix ("01.", "02.") in the ACCENT COLOR (defined in preamble)
  - Item text in white sans-serif mixed-case regular weight, ~22-28pt
  - 3-6 items total. Render verbatim:
{{itemLines}}

BOTTOM REGION (full-bleed contextual visual)
- Photoreal scene OR stylized illustration matching the list's topic.
- Examples: red lock icon over book pages for a copyright list / circuit board for AI hardware list / podium for political list / trading floor for business list.
- Soft top-edge darkening to blend with the panel.

CORNER:
CORNER METADATA: bottom-right corner. Render the EXACT text below in small monospace 16pt, colored in the ACCENT COLOR. NEVER render the hex code as visible text:
{{slideNumber}} / -

NEGATIVE: NO Instagram UI, NO brand handle, NO @username, NO wordmark, NO bullets (numbers only), NO em dashes (period/comma/colon/hyphen only). NO captions burned into the bottom image.

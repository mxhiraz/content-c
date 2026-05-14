{{stylePreamble}}

LAYOUT: stat-card slide, 4:5 portrait. Matches @getintoai DNA — split composition:
- TOP HALF (~55%): solid black panel with the huge stat + caption
- BOTTOM HALF (~45%): full-bleed photoreal contextual photo (the company/product/scene the stat references)

TOP REGION (black panel, generous padding)
- Massive condensed sans-serif stat (Druk Wide / Anton style), ~180-240pt, centered:
  "{{stat}}"
- If the stat contains a number + unit ("10M USERS", "$50B"), color the NUMBER portion in the ACCENT COLOR (defined in preamble), keep the unit white. Otherwise color the most surprising word in the ACCENT COLOR.
- Caption below the stat (mixed-case white sans-serif at ~24-30pt, max 2 lines, centered):
  "{{caption}}"

BOTTOM REGION (full-bleed contextual photo)
- Photoreal scene tied to the stat: company HQ, executive face, product shot, market floor, courtroom, datacenter, whatever the stat is about.
- Documentary realism, not stock photography vibe.
- Soft darkening at top edge so it blends into the panel.

CORNER:
CORNER METADATA: bottom-right corner. Render the EXACT text below in small monospace 16pt, colored in the ACCENT COLOR. NEVER render the hex code as visible text:
{{slideNumber}} / -

NEGATIVE: NO Instagram UI, NO brand handle, NO @username, NO wordmark, NO swipe arrow, NO em dashes (period/comma/colon/hyphen only). NO captions burned into the photo.

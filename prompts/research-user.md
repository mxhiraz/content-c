Today is {{today}}. PIPELINE = {{feedUpper}} ({{feedLabel}}).

YOUR JOB IS TWO-PHASE:

PHASE 1 — TREND DISCOVERY (mandatory, run first):
Use web_search to actively scrape these EXACT sources and figure out what's hot in AI for THIS pipeline RIGHT NOW. Don't summarize from training data — search live.
{{sourceHints}}

QUERY HINTS (run 6-10 of these via web_search, mix and match):
{{queries}}
Add follow-up searches when you spot a hot signal (e.g. if you see "DeepSeek V4" trending on HN, search "DeepSeek V4 announcement" + "DeepSeek V4 demo" to triangulate).

PHASE 2 — STORY PICK + ASSET HARVEST:
For each viral signal you found, use web_search again to:
- find the primary-source URL (Tier 1 lab blog > Tier 2 outlet)
- collect 0-6 IMAGE URLs you actually saw in search results (og:image, hero shots, charts, screenshots) — NEVER fabricate URLs
- collect 0-4 VIDEO URLs (X/Twitter status URLs, YouTube video URLs, official press videos)
- collect 1-3 entity X handles (the official org / founder posting about it)

SELECTION RULE FOR THIS PIPELINE:
{{selectionRule}}

Find the top stories matching this pipeline from the last 24-48h. Return at least {{minCandidates}} candidates so I can pick the best ones. Use web_search aggressively before writing JSON.

CRITICAL: never invent URLs. If web_search did not surface a clickable URL, return [] for that field.

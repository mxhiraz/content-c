You research current Instagram carousel copywriting best practices for the {{niche}} niche. Use web_search aggressively. Today is {{today}}.

Search live for:
1. Top-performing IG carousel hooks in {{niche}} from the last 30 days
2. Mosseri / Meta algorithm signal updates from the last 90 days (saves, sends, watch-time, comments-over-N-words)
3. Banned-phrase / AI-slop detector lists updated in the last 90 days
4. Viral hook frameworks practitioners are quoting right now (Open Loop, Stat-Slap, Pattern Interrupt, etc.)
5. Caption structures (line-by-line) creators currently swear by

Return ONE JSON object verbatim, no prose, no markdown fences:
{
  "niche": "{{niche}}",
  "viralHookPatterns": ["6-10 named hook frameworks with one-line description, e.g. 'Stat-Slap: lead with brain-breaking number, then implication in 5 words'"],
  "voiceRules": ["6-10 short voice/tone rules currently working in the niche"],
  "bannedPhrases": ["20-40 cliches/AI-slop words/phrases that tank reach in 2026"],
  "algoTargets": ["4-6 IG signals that matter most right now, with verb the post should engineer for"],
  "examples": [{ "hook": "actual hook from a viral post you observed", "whyItWorks": "1 sentence" }],
  "captionStructure": ["line-by-line caption template, 6-9 entries"]
}

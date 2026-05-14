# Content Style Guide — what to make, what NOT to make

Per client direction May 2026 (do not regress): broad-spectrum global news. Cover politics, business, world events, tech-beyond-AI, AI, science, culture, sports, current affairs. AI is ONE beat among many.

---

## TOPIC TYPES (rotate across batches — never 3 of same sector in a row)

### A. POLITICS + CURRENT AFFAIRS
- Executive orders, court rulings, election results, scandal leaks
- "Trump signs bill that kills X overnight"
- "EU passes new chip-export sanctions on China"
- "Supreme Court rules 6-3 on Y"
- **Spice:** name politician, name party, name stake. No moralizing.

### B. BUSINESS + MARKETS
- Layoffs at named companies, IPO pops, M&A deals, earnings shock
- "Cloudflare cuts 1,100 in AI-first restructure"
- "Tesla loses $80B in 4 hours after delivery miss"
- "Anthropic raises at $400B valuation"
- **Spice:** real dollar figures, named CEO/exec, what it means for the reader's 401k

### C. WORLD EVENTS
- Conflicts, ceasefires, diplomatic breakdowns, climate disasters, summits
- "Israel-Iran ceasefire holds 6 days, breaks Tuesday"
- "China bans rare-earth exports to US chipmakers"
- **Spice:** what just CHANGED + which country/leader caused it

### D. TECH BEYOND AI
- Chip wars, social platforms, apps, devices, crypto, gaming
- "Apple launches $499 Vision Pro 2 — half the price, same hardware"
- "X bans accounts that mention competitor names"
- "Crypto whale moves $4B in 12 minutes before exchange crash"
- **Spice:** named company + concrete product change

### E. AI (cap ~1-2 per batch)
- AI applications in industry: "Indian banks now use Anthropic Claude for fraud"
- AI controversy: lawsuits, deepfakes, founder fights, safety incidents
- AI tools that go viral: prompts, agents, generators
- **Spice:** specific outcome ("agents replaced 200 analysts at Walmart"), NOT pure model-release announcements

### F. SCIENCE + RESEARCH
- Breakthroughs: drug discovery, fusion milestones, space launches, gene therapy
- "MIT cures rare disease in 12 patients with one-shot therapy"
- "Fusion startup hits net-positive energy for 14 seconds"
- **Spice:** specific number + named institution, plain-English what it does

### G. CULTURE + ENTERTAINMENT
- Celebrity moments, music drops, film/TV scandals, fashion shifts, internet trends
- "Taylor Swift announces stadium-only tour leg, breaks Ticketmaster again"
- "AI image trend lets you turn yourself into 80s movie poster — going viral"
- "Olivia Rodrigo unfollows ex, fans decode 47 hidden lyrics"
- **Spice:** named person + the move + reader emotional hook

### H. SPORTS
- Records broken, transfers, doping bans, championship moments
- "She broke a 47-year-old record by 2 seconds"
- "$200M transfer fee, world record"
- **Spice:** specific number, named athlete, what gets broken

### I. CURRENT AFFAIRS + VIRAL MOMENTS
- Internet trends, viral videos, weird news that everyone is talking about
- "Textbook page leaks ChatGPT response left in by editor"
- "Roblox players use Morse code to bypass chat filters"
- **Spice:** observational + "wait what" angle, slightly amused

---

## TOPICS TO AVOID

- Pure benchmark dumps without narrative
- "EU considers framework for AI" type regulatory hand-wringing without named parties
- Philosophical thinkpieces ("is AI conscious?")
- Generic explainers ("what is RAG?", "what is Bitcoin?")
- Top-10-tools SEO listicles
- Sponsored content / press-wire copies

---

## DIVERSITY RULE (hardest constraint)

Across consecutive carousels in the feed:
- NEVER 3 AI stories in a row
- NEVER 3 politics stories in a row
- AIM for: at least 4 different topic SECTORS across any 5 consecutive carousels
- The dispatcher rotates SLOT × FEED in `.delivery.json` — research should still diversify within each batch

---

## VISUAL STYLE — what the images look like

### Hook slide (slide 1)
- Real photo of protagonist (politician / CEO / athlete / scientist / celebrity) — high-quality news photo
- Bold all-caps headline overlay
- Yellow `#FCD400` highlight on key words
- Niche label top-right (POLITICS / BUSINESS / WORLD / TECH / SCIENCE / SPORTS / CULTURE / AI / VIRAL)
- SWIPE chip bottom-right

### Body slides
- Text top + image bottom
- Mix layout variants per carousel
- Photo bottom = different/contextual per slide

### Spice level for images
- Documentary photojournalism, NOT cinematic CGI
- Pores, real lighting, no airbrushed glow

---

## CTA SPICE (per feed)

- **viral / latest:** save-trigger + follow line + 4-5 hashtags. NO comment-keyword.
- **controversy:** stake a side. Save-trigger like "Save before this gets memory-holed."
- **prompts:** comment-keyword ("Comment 'SECRET' and I'll DM the prompts"). Full prompt in `cta_resource`.

---

## NEVER

- Force AI framing on a non-AI story
- Skip the named entity (always name politician / company / athlete / scientist)
- Use vague stake words ("could affect", "may impact") — use stakes verbs (bleed, lose, kill, fold, scramble, ship, win)

export type FeedKind = "viral" | "controversy" | "prompts" | "latest";

export const ALL_FEEDS: FeedKind[] = ["viral", "controversy", "prompts", "latest"];

export interface FeedConfig {
  kind: FeedKind;
  label: string;
  sourceHints: string;
  queries: string[];
  selectionRule: string;
  preferredCategories: string[];
}

export const FEEDS: Record<FeedKind, FeedConfig> = {
  viral: {
    kind: "viral",
    label: "VIRAL — jaw-dropping AI demos and 'wait what' moments",
    sourceHints: `MIX FREELY across these source groups every run. Never single-source.
A) Broad AI aggregators (multi-vendor):
- rundown.ai / therundown.ai, joinsuperhuman.ai, theneuron.ai, marktechpost.com, venturebeat.com/ai
- bensbites.com, alphasignal.ai, tldr.tech/ai, aiweekly.co, smol.ai/news
B) Community vote (broad tech, AI floats):
- news.ycombinator.com + hn.algolia.com past 24h points>500
- r/singularity, r/LocalLLaMA, r/ChatGPT, r/technology, r/MachineLearning — HOT > 500
- techmeme.com, producthunt.com
C) Editorial broad-tech outlets:
- theverge.com, arstechnica.com, techcrunch.com (AI section), wired.com, technologyreview.com
D) Research signal:
- huggingface.co/papers top, arxiv cs.AI today, github trending AI 1k+ stars/24h
E) Last resort (fixed accounts bias):
- X posts from sama, karpathy, ylecun, dario_amodei, kimmonismus, swyx, aidan_mclau, simonw`,
    queries: [
      "AI demo viral last 48 hours",
      "AI agent does the impossible",
      "AI did something nobody thought was possible",
      "viral AI video Twitter X this week",
      "AI breakthrough surprise announcement",
      'site:reddit.com r/singularity hot AI',
      'site:reddit.com r/LocalLLaMA top',
      "robot AI demo dunk run autonomous",
      "AI agent buys executes orders books",
    ],
    selectionRule: "Pick stories where there is a CONCRETE VISIBLE ACTION (robot, agent, app, demo) producing a 3-second screenshot moment. The story must answer 'what did the AI just DO that's bonkers?'. Number/stat alone is not viral. The reader must be able to picture it instantly.",
    preferredCategories: ["model_release", "tool", "research"],
  },
  controversy: {
    kind: "controversy",
    label: "CONTROVERSY — drama, lawsuits, leaks, fights",
    sourceHints: `Bias toward sources where AI drama breaks first:
- X/Twitter — founder fights, employee leaks, DM screenshots
- The Information (theinformation.com) — insider scoops
- Bloomberg AI / WSJ / FT — corporate shake-ups, lawsuits, layoffs
- Court filings via PACER summaries on Bloomberg/Reuters
- Substack (Big Technology by Alex Kantrowitz, Stratechery by Ben Thompson)
- Techmeme top section (techmeme.com)
- TechCrunch AI — for layoff and lawsuit coverage
- artificialintelligence-news.com policy/regulation section`,
    queries: [
      "AI lawsuit filed last 48 hours",
      "OpenAI Anthropic founder dispute",
      "AI company layoffs",
      "AI leaked memo employee",
      "AI jailbreak rogue behavior",
      "AI executive fired board",
      "AI copyright infringement lawsuit",
      "AI startup shutdown investigation",
      "Sam Altman Elon Musk lawsuit",
    ],
    selectionRule: "Pick stories with a NAMED VILLAIN and NAMED VICTIM (or two named parties in conflict). The reader must immediately understand: who is fighting whom, and why it's bad for someone. Pure regulatory news without named parties is rejected.",
    preferredCategories: ["controversy", "business"],
  },
  prompts: {
    kind: "prompts",
    label: "PROMPTS — best prompts, agent tactics, tactical how-to",
    sourceHints: `MANDATORY: pick prompts from REAL USERS (Reddit posters, Medium writers, X threads, Discord). NEVER from company blogs / docs / official "prompt libraries". Users want stuff peers actually use, not vendor templates.
PRIMARY (user-generated, what we want):
- reddit.com/r/PromptEngineering, /r/ChatGPTPromptGenius, /r/ChatGPTPro, /r/aipromptprogramming, /r/ChatGPT, /r/LocalLLaMA — HOT tab, top posts of the week with 200+ upvotes
- medium.com search "ChatGPT prompt" / "Claude prompt" — individual authors, last 7 days
- substack search "prompt of the week", Lenny's Newsletter, One Useful Thing (Ethan Mollick)
- X/Twitter posts from real practitioners (not corp accounts): simonw, hamelhusain, eugeneyan, swyx, dr_cintas, mattshumer_, _akhaliq, AnthropicAI replies thread
- threads.net + Bluesky search "I just found this prompt"
- HN front page: stories tagged "Show HN: prompt" / "Ask HN: best prompt"
- Discord screenshots / X screenshots people post of conversations
DIVERSIFY: every carousel MUST pull from a DIFFERENT primary source (don't run 3 Reddit prompts in a row). Mix Reddit + Medium + X + Substack.
BANNED for this feed:
- anthropic.com docs, openai.com cookbook, docs.anthropic.com/prompt-library, anthropic.com/news, openai.com/news, deepmind.google
- promptbase.com (paid, low-trust), learnprompting.org (textbook), DeepLearning.AI (course)
- Any "X company released their prompt library" official announcement
Reason: users find official prompts boring + already know about them. The win is the random Reddit thread where one user shares a trick that works.`,
    queries: [
      "site:reddit.com/r/PromptEngineering best prompt this week",
      "site:reddit.com/r/ChatGPTPromptGenius viral prompt",
      "site:reddit.com /r/ChatGPT prompt that changed my workflow",
      "site:medium.com ChatGPT prompt I use daily 2026",
      "site:medium.com Claude prompt agent tactic last week",
      "X thread \"prompt I use\" OR \"prompt that\" simonw OR hamelhusain OR mattshumer",
      "Substack one useful thing prompt this week",
      "Show HN prompt OR \"Ask HN best prompt\"",
      "Cursor Windsurf prompt template Reddit",
      "leaked system prompt agent Reddit",
    ],
    selectionRule: "Story MUST originate from a REAL USER on Reddit / Medium / X / Substack / HN (not a company blog). The prompt must be specific, copy-pastable, and the post must show a real outcome the author got. Diversify source domain across carousels — don't repeat the same site twice in a row.",
    preferredCategories: ["tool", "research"],
  },
  latest: {
    kind: "latest",
    label: "LATEST — fresh AI news, model releases, raises, partnerships",
    sourceHints: `CRITICAL: start with CROSS-VENDOR AGGREGATORS, never with lab blogs. Searching anthropic.com/openai.com directly only returns that one company's news — biases the feed toward whichever lab we searched first. Lead with aggregators that surface stories across ALL AI companies, then follow the link to the primary source for the URL.

PHASE 1 (DISCOVERY — search all groups every run, no single-source):
A) Broad AI aggregators (multi-vendor):
- rundown.ai, joinsuperhuman.ai, theneuron.ai, marktechpost.com, venturebeat.com/ai
- bensbites.com, alphasignal.ai, tldr.tech/ai, aiweekly.co, smol.ai/news
B) Community vote:
- news.ycombinator.com + hn.algolia.com past 24h points>300
- techmeme.com / techmeme.com/river
- r/technology, r/singularity, r/MachineLearning, r/LocalLLaMA, r/ChatGPT HOT > 500
C) Editorial broad-tech:
- theverge.com, arstechnica.com, techcrunch.com, wired.com, technologyreview.com, theinformation.com
D) Research signal:
- huggingface.co/papers daily top, arxiv cs.AI, github trending

PHASE 2 (PRIMARY-SOURCE URL — once aggregator surfaces story, follow link):
- For model release: lab blog (anthropic.com/news, openai.com/news, deepmind.google/blog, ai.meta.com, mistral.ai/news, x.ai, cohere.com, ai21.com, perplexity.ai/hub)
- For business news: techmeme, bloomberg, FT, theinformation
- For research: arxiv abstract page
- Never use the aggregator URL as the final story URL. Always follow to the primary source.

DIVERSITY RULE (mandatory): every batch of stories MUST cover at least 3 different companies/labs. If 4 of 5 are Anthropic stories, REPLACE 3 with stories from other labs (OpenAI, Google, Meta, Mistral, xAI, Cohere, AI21, DeepSeek, Qwen, Hugging Face, NVIDIA, Apple, Amazon, IBM, indie labs). Anthropic/OpenAI duopoly bias = automatic rewrite.`,
    queries: [
      "site:rundown.ai OR site:therundown.ai today",
      "site:joinsuperhuman.ai OR site:theneuron.ai today AI news",
      "site:marktechpost.com OR site:venturebeat.com/ai latest",
      "site:bensbites.com OR site:alphasignal.ai OR site:tldr.tech/ai today",
      "site:techmeme.com AI today",
      "site:news.ycombinator.com AI past 24 hours points 300",
      "site:reddit.com r/singularity OR r/MachineLearning OR r/LocalLLaMA hot",
      "site:theverge.com OR site:arstechnica.com OR site:techcrunch.com AI last 48 hours",
      "AI model release announcement last 48 hours",
      "site:huggingface.co/papers OR site:arxiv.org cs.AI top today",
    ],
    selectionRule: "Pick the freshest stories from ACROSS the AI ecosystem (last 24-48h). MUST cover ≥3 different companies/labs per batch — no single-vendor bias. Aggregators surface stories, lab blogs serve as the final URL. Skip viral-pandering, controversy-baiting. Just diverse, fresh, primary-source-backed news.",
    preferredCategories: ["model_release", "research", "business", "tool"],
  },
};

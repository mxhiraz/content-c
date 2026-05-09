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
    sourceHints: `Bias toward sources where viral AI content lives:
- X/Twitter posts from named AI demo accounts (kimmonismus, iruletheworldmo, aidan_mclau, swyx, sama, karpathy, ylecun, dario_amodei) — most viral demos hit X first
- r/singularity, r/LocalLLaMA, r/ChatGPT — top 24h posts
- HuggingFace daily papers (top upvoted)
- HN front page (>500 upvotes)
- TechCrunch AI section (techcrunch.com/category/artificial-intelligence)
- aimagazine.com — for visual-first AI stories
- artificialintelligence-news.com — for tech-demo coverage`,
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
    sourceHints: `Bias toward sources for power-user / replicable AI tactics:
- r/PromptEngineering, r/ChatGPTPromptGenius, r/LocalLLaMA hot
- X/Twitter threads: latentspace.com, swyx, simonw, anissia, hamelhusain, eugeneyan — "I just discovered this prompt that..."
- promptbase.com (paid prompts trending)
- learnprompting.org
- DeepLearning.AI short courses (deeplearning.ai)
- Anthropic Cookbook + OpenAI Cookbook (cookbook.openai.com)
- AnthropicAI prompt library (docs.anthropic.com/claude/prompt-library)
- Greg Brockman / Karpathy tweet threads on technique
- aimagazine.com tutorials
- artificialintelligence-news.com tutorials section`,
    queries: [
      "best ChatGPT prompt this week",
      "Claude Opus prompt tactic agent",
      "AI agent prompt template viral",
      "prompt engineering trick discovered",
      "AI workflow automation prompt thread",
      "Cursor Windsurf coding prompt",
      "system prompt leaked Anthropic OpenAI",
      "prompt that 10x my productivity",
    ],
    selectionRule: "Pick stories that contain a SPECIFIC, COPY-PASTABLE prompt or tactic. The reader must be able to use the technique within 60 seconds of reading. Pure 'AI is useful' takes are rejected. The carousel will SHOW the prompt verbatim.",
    preferredCategories: ["tool", "research"],
  },
  latest: {
    kind: "latest",
    label: "LATEST — fresh AI news, model releases, raises, partnerships",
    sourceHints: `Authoritative-first chain. Speed > viral:
- Lab blogs (anthropic.com/news, openai.com/news, deepmind.google/blog, ai.meta.com, mistral.ai/news, x.ai)
- Techmeme (techmeme.com) — fastest aggregator
- The Information / Bloomberg / Reuters / FT
- TechCrunch AI category (techcrunch.com/category/artificial-intelligence)
- aimagazine.com daily news
- artificialintelligence-news.com latest section
- The Verge AI section
- Hugging Face papers (latest)
- arxiv cs.AI cs.LG submissions today`,
    queries: [
      "AI news today last 24 hours",
      "AI model release announcement",
      "AI startup raised funding",
      "AI research paper published this week",
      "AI partnership acquisition announced",
      "site:techmeme.com AI",
      "AI breaking news",
      'site:anthropic.com/news OR site:openai.com/news OR site:deepmind.google',
    ],
    selectionRule: "Pick the freshest, most-objectively-newsworthy AI events (last 24h preferred). Lab blogs > major outlets > aggregators. Skip viral-pandering, controversy-baiting. Just the news, ranked by primary-source provenance + freshness.",
    preferredCategories: ["model_release", "research", "business", "tool"],
  },
};

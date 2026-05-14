export const config = {
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  falKey: process.env.FAL_KEY ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  openrouterModel: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat-v3.1",
  brand: {
    handle: process.env.BRAND_HANDLE ?? "@unfoldedai",
    highlightColor: process.env.BRAND_HIGHLIGHT_COLOR ?? "#A855F7",
  },
  pipeline: {
    maxArticlesPerRun: int("MAX_ARTICLES_PER_RUN",1),
    lookbackHours: int("LOOKBACK_HOURS", 24),
    outputDir: process.env.OUTPUT_DIR ?? "./out",
    imageProvider: (process.env.IMAGE_PROVIDER ?? "gemini") as "gemini" | "fal",
    maxSlides: clampInt("MAX_SLIDES", 4, 4, 10),
  },
  models: {
    contentModel: "claude-sonnet-4-6",
    scoringModel: "claude-haiku-4-5-20251001",
    imageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview",
  },
} as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(name: string, fallback: number, min: number, max: number): number {
  const n = int(name, fallback);
  return Math.max(min, Math.min(max, n));
}

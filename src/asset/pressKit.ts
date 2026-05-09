import { log } from "../log.js";
import type { ExtractedAsset } from "./extractor.js";

// Map entity → official press / newsroom URLs that are safe to scrape og:image from
const PRESS_PAGES: Record<string, string[]> = {
  "openai.com": [
    "https://openai.com/news/",
    "https://openai.com/blog/",
    "https://openai.com/index/",
  ],
  "anthropic.com": [
    "https://www.anthropic.com/news",
    "https://www.anthropic.com/research",
  ],
  "deepmind.google": [
    "https://deepmind.google/discover/blog/",
  ],
  "ai.meta.com": [
    "https://ai.meta.com/blog/",
  ],
  "mistral.ai": [
    "https://mistral.ai/news",
  ],
  "x.ai": [
    "https://x.ai/news",
  ],
  "huggingface.co": [
    "https://huggingface.co/blog",
    "https://huggingface.co/papers",
  ],
  "nvidia.com": [
    "https://nvidianews.nvidia.com/news",
    "https://blogs.nvidia.com/blog/category/generative-ai/",
  ],
  "apple.com": [
    "https://www.apple.com/newsroom/",
  ],
  "google.com": [
    "https://blog.google/technology/ai/",
  ],
};

export const PRESS_DOMAINS = new Set(Object.keys(PRESS_PAGES));

export function getPressPages(domain: string): string[] {
  const cleaned = domain.replace(/^www\./, "").toLowerCase();
  return PRESS_PAGES[cleaned] ?? [];
}

export function isPressDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return PRESS_DOMAINS.has(host);
  } catch {
    return false;
  }
}

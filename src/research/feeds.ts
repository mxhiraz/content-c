// Feed configs are loaded from prompts/feeds.json via the skills loader.
// To edit a feed's sources / queries / selection rule, edit prompts/feeds.json — NOT this file.

import { skills, type FeedKind, type FeedConfig } from "../skills/loader.js";

export type { FeedKind, FeedConfig };

export const ALL_FEEDS: FeedKind[] = ["viral", "controversy", "prompts", "latest"];

// Lazy proxy — every read goes through the loader (cached, hot-reloadable).
export const FEEDS: Record<FeedKind, FeedConfig> = new Proxy({} as Record<FeedKind, FeedConfig>, {
  get(_target, prop: string) {
    return skills.feeds()[prop as FeedKind];
  },
  ownKeys() {
    return Object.keys(skills.feeds());
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const cfg = skills.feeds()[prop as FeedKind];
    return cfg ? { configurable: true, enumerable: true, value: cfg } : undefined;
  },
});

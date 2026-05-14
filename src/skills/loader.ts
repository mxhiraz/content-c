// Skills loader — single source of truth for ALL prompts.
//
// Architecture: prompts live in /prompts/*.md (long-form) or /prompts/*.json (structured).
// This file reads them at runtime (cached in memory, with manual invalidation hook).
// Every source file that needs a prompt imports from here — NO inline prompts anywhere else.
//
// Templates use double-brace syntax {{varName}} which the loader fills via fill().
// For structured data (feed configs, format catalog) we use JSON, not markdown templates.

import { readFileSync, watch as fsWatch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// /prompts/ sits at repo root. From src/skills/loader.ts that's ../../prompts.
// In Docker the file is at /app/src/skills/loader.ts so /app/prompts.
// Override via PROMPTS_DIR env if needed.
const PROMPTS_DIR =
  process.env.PROMPTS_DIR ?? path.resolve(__dirname, "..", "..", "prompts");

const textCache = new Map<string, string>();
const jsonCache = new Map<string, unknown>();

function readText(rel: string): string {
  const cached = textCache.get(rel);
  if (cached !== undefined) return cached;
  const full = path.join(PROMPTS_DIR, rel);
  const content = readFileSync(full, "utf8");
  textCache.set(rel, content);
  return content;
}

function readJson<T>(rel: string): T {
  const cached = jsonCache.get(rel) as T | undefined;
  if (cached !== undefined) return cached;
  const text = readText(rel);
  const parsed = JSON.parse(text) as T;
  jsonCache.set(rel, parsed);
  return parsed;
}

/** Fill {{var}} placeholders. Missing vars stay as-is (visible in output → easy debug). */
function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return `{{${key}}}`;
    return String(v);
  });
}

/** Wipe cache so next read picks up edited files. Hooked into config UI's reload button. */
export function invalidateSkillsCache(): void {
  textCache.clear();
  jsonCache.clear();
}

/** Optional dev-mode auto-reload: invalidates cache on file changes inside prompts/. */
export function startSkillsWatcher(): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    fsWatch(PROMPTS_DIR, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      invalidateSkillsCache();
    });
  } catch {
    /* watch unsupported on this platform — ignore */
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export type FeedKind = "viral" | "controversy" | "prompts" | "latest";

export interface FeedConfig {
  kind: FeedKind;
  label: string;
  sourceHints: string;
  queries: string[];
  selectionRule: string;
  preferredCategories: string[];
}

export type FormatName =
  | "news_drop"
  | "myth_bust"
  | "stat_stack"
  | "before_after"
  | "insider_pov"
  | "question_hook"
  | "diagram_flow"
  | "receipts";

export const skills = {
  research: {
    /** Top-level research SYSTEM prompt sent to Claude with web_search tool. */
    system: (): string => readText("research-system.md"),
    /** User-message template. Vars: today, feedUpper, feedLabel, sourceHints, queries, selectionRule, minCandidates. */
    user: (vars: {
      today: string;
      feedUpper: string;
      feedLabel: string;
      sourceHints: string;
      queries: string;
      selectionRule: string;
      minCandidates: number | string;
    }): string => fill(readText("research-user.md"), vars),
  },

  /** Feed-lane configs (viral / controversy / prompts / latest). Structured JSON. */
  feeds: (): Record<FeedKind, FeedConfig> =>
    readJson<Record<FeedKind, FeedConfig>>("feeds.json"),

  slideSpec: {
    /**
     * Slide-spec SYSTEM prompt. Vars: maxSlides, bodyCount, structure (pre-built block),
     * formatBlock (pre-built), playbookBlock (pre-built).
     */
    system: (vars: {
      maxSlides: number;
      bodyCount: number;
      minBodyCount: number;
      minSlides: number;
      structure: string;
      formatBlock: string;
      playbookBlock: string;
    }): string =>
      fill(readText("slide-spec-system.md"), {
        ...vars,
        bodyCountPlusOne: vars.bodyCount + 1,
        // content-style-guide.md is read fresh — edits propagate without code touch.
        topicGuide: readText("content-style-guide.md"),
      }),

    /** User message. Vars: brandHandle, maxSlides, bodyCount, feedHint, source, url, title, body. */
    user: (vars: {
      brandHandle: string;
      maxSlides: number;
      bodyCount: number;
      feedHint: string;
      source: string;
      url: string;
      title: string;
      body: string;
    }): string => fill(readText("slide-spec-user.md"), vars),
  },

  /** Per-format slide-by-slide spec strings (news_drop, myth_bust, etc). */
  formats: (): Record<FormatName, string> =>
    readJson<Record<FormatName, string>>("format-catalog.json"),

  playbook: {
    /** Playbook research SYSTEM. Vars: niche, today. */
    system: (vars: { niche: string; today: string }): string =>
      fill(readText("playbook-system.md"), vars),
  },

  render: {
    /** Shared style preamble used by every image prompt. Vars: highlightHex. */
    style: (vars: { highlightHex: string }): string =>
      fill(readText("render/style.md"), vars),

    /** Hook image prompt. Vars: stylePreamble, headline, subTag, highlightHex,
     *  highlightedWords, subjectPhotoQuery, backgroundScene, overlayConcept. */
    hook: (vars: {
      stylePreamble: string;
      headline: string;
      subTag: string;
      highlightHex: string;
      highlightedWords: string;
      subjectPhotoQuery: string;
      backgroundScene: string;
      overlayConcept: string;
    }): string => fill(readText("render/hook.md"), vars),

    /** text_explainer body slide. */
    bodyTextExplainer: (vars: {
      stylePreamble: string;
      headline: string;
      bodyParagraph: string;
      highlightHex: string;
      highlightLine: string;
      emphasisLine: string;
      topRegion: string;
      slideNumber: number | string;
    }): string => fill(readText("render/body-text-explainer.md"), vars),

    /** stat_card body slide. */
    bodyStatCard: (vars: {
      stylePreamble: string;
      stat: string;
      caption: string;
      highlightHex: string;
      slideNumber: number | string;
    }): string => fill(readText("render/body-stat-card.md"), vars),

    /** quote_pull body slide. */
    bodyQuotePull: (vars: {
      stylePreamble: string;
      quote: string;
      attribution: string;
      highlightHex: string;
      slideNumber: number | string;
    }): string => fill(readText("render/body-quote-pull.md"), vars),

    /** list_card body slide. */
    bodyListCard: (vars: {
      stylePreamble: string;
      title: string;
      itemLines: string;
      highlightHex: string;
      slideNumber: number | string;
    }): string => fill(readText("render/body-list-card.md"), vars),
  },
};

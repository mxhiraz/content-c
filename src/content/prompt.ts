// Slide-spec prompts moved to prompts/slide-spec-{system,user}.md.
// Format catalog moved to prompts/format-catalog.json.
// Edit those files instead of inline strings here.

import { playbookToPromptBlock, type Playbook } from "./playbook.js";
import type { FormatName } from "./recentFormats.js";
import { skills } from "../skills/loader.js";

export function buildSystemPrompt(maxSlides: number, playbook?: Playbook, eligibleFormats?: FormatName[], minSlides?: number): string {
  const bodyCount = Math.max(1, maxSlides - 1);
  const minBodyCount = Math.max(1, (minSlides ?? maxSlides) - 1);
  const playbookBlock = playbook ? playbookToPromptBlock(playbook) : "";

  const formatSpecs = skills.formats();
  const formats = eligibleFormats && eligibleFormats.length
    ? eligibleFormats
    : (Object.keys(formatSpecs) as FormatName[]);
  const formatBlock = formats.map((f) => `- ${f}: ${formatSpecs[f]}`).join("\n");

  // Per-bodyCount slide-by-slide instructions (3 branches).
  const structure =
    bodyCount >= 3
      ? `- Body slide 1 (S2): WHAT HAPPENED. One short setup sentence, then 3 bullet-style facts. Reward the swipe in 3 seconds. Make this slide DENSE so the reader slows down (slows swipe = more watch-time).
- Body slide 2 (S3): WHY IT MATTERS. The second-order effect that other accounts will MISS. Pick one named loser (the company / team / market about to be hurt) and one named winner. Stake a position.
- Body slide 3 (S4): THE TAKE + SAVE/SHARE BAIT. State the single sentence the reader should remember. End with an explicit save/share/comment line ("Save this. You'll want it next week." or "Comment X and I'll DM the link.").`
      : bodyCount === 2
      ? `- Body slide 1 (S2): WHAT HAPPENED. Short setup + 2-3 bullets. Reward the swipe in 3 seconds.
- Body slide 2 (S3): WHY IT MATTERS + THE TAKE. Named loser, named winner, one explicit save/share line at the end.`
      : `- Body slide 1: the single most surprising fact + why it matters + a save/share line.`;

  return skills.slideSpec.system({
    maxSlides,
    bodyCount,
    minBodyCount,
    minSlides: minSlides ?? maxSlides,
    structure,
    formatBlock,
    playbookBlock,
  });
}

export function buildUserPrompt(
  article: { title: string; url: string; body: string; source: string; feed?: string },
  brandHandle: string,
  maxSlides: number,
): string {
  const bodyCount = Math.max(1, maxSlides - 2);
  const feedHint = article.feed
    ? `\nFEED LANE: ${article.feed.toUpperCase()} (apply lane-specific overrides from system prompt).\n`
    : "";
  return skills.slideSpec.user({
    brandHandle,
    maxSlides,
    bodyCount,
    feedHint,
    source: article.source,
    url: article.url,
    title: article.title,
    body: article.body || "(no body: use only the title; if too thin, return insufficient_source_material)",
  });
}

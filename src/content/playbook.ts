import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { log } from "../log.js";

const PLAYBOOK_PATH = path.join(config.pipeline.outputDir, ".playbook.json");
const TTL_MS = 7 * 24 * 3600 * 1000;

export interface Playbook {
  generatedAt: string;
  niche: string;
  viralHookPatterns: string[];
  voiceRules: string[];
  bannedPhrases: string[];
  algoTargets: string[];
  examples: { hook: string; whyItWorks: string }[];
  captionStructure: string[];
}

const FALLBACK: Playbook = {
  generatedAt: new Date(0).toISOString(),
  niche: "ai-tech",
  viralHookPatterns: [],
  voiceRules: [],
  bannedPhrases: [],
  algoTargets: [],
  examples: [],
  captionStructure: [],
};

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

export async function loadPlaybook(force = false): Promise<Playbook> {
  if (!force) {
    try {
      const raw = await readFile(PLAYBOOK_PATH, "utf8");
      const pb = JSON.parse(raw) as Playbook;
      const age = Date.now() - Date.parse(pb.generatedAt);
      if (age < TTL_MS) {
        log.info("playbook", `using cached playbook (age ${(age / 3600 / 1000).toFixed(0)}h)`);
        return pb;
      }
      log.info("playbook", `cached playbook stale (${(age / 24 / 3600 / 1000).toFixed(1)}d), refreshing`);
    } catch {
      log.info("playbook", "no cached playbook, refreshing");
    }
  }
  return refreshPlaybook();
}

export async function refreshPlaybook(): Promise<Playbook> {
  const niche = process.env.NICHE ?? "AI/tech";
  const today = new Date().toISOString().slice(0, 10);
  const sys = `You research current Instagram carousel copywriting best practices for the ${niche} niche. Use web_search aggressively. Today is ${today}.

Search live for:
1. Top-performing IG carousel hooks in ${niche} from the last 30 days
2. Mosseri / Meta algorithm signal updates from the last 90 days (saves, sends, watch-time, comments-over-N-words)
3. Banned-phrase / AI-slop detector lists updated in the last 90 days
4. Viral hook frameworks practitioners are quoting right now (Open Loop, Stat-Slap, Pattern Interrupt, etc.)
5. Caption structures (line-by-line) creators currently swear by

Return ONE JSON object verbatim, no prose, no markdown fences:
{
  "niche": "${niche}",
  "viralHookPatterns": ["6-10 named hook frameworks with one-line description, e.g. 'Stat-Slap: lead with brain-breaking number, then implication in 5 words'"],
  "voiceRules": ["6-10 short voice/tone rules currently working in the niche"],
  "bannedPhrases": ["20-40 cliches/AI-slop words/phrases that tank reach in 2026"],
  "algoTargets": ["4-6 IG signals that matter most right now, with verb the post should engineer for"],
  "examples": [{ "hook": "actual hook from a viral post you observed", "whyItWorks": "1 sentence" }],
  "captionStructure": ["line-by-line caption template, 6-9 entries"]
}`;

  log.step("playbook", "refreshing playbook via Claude + web_search");
  // Use Haiku 4.5 here — playbook is structural copy research, weekly cron, doesn't need Sonnet.
  // Haiku 4.5 = 3× cheaper than Sonnet 4.6 ($1/$5 vs $3/$15 per M tokens).
  const stream = anthropic.messages.stream({
    model: config.models.scoringModel,
    max_tokens: 4000,
    system: sys,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    messages: [{ role: "user", content: `Refresh the ${niche} viral-copy playbook for today.` }],
  });
  let buf = "";
  stream.on("text", (delta) => { buf += delta; });
  await stream.finalMessage();

  const cleaned = buf.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let parsed: Playbook;
  try {
    const json = JSON.parse(start === -1 ? cleaned : cleaned.slice(start, end + 1));
    parsed = {
      generatedAt: new Date().toISOString(),
      niche: typeof json.niche === "string" ? json.niche : niche,
      viralHookPatterns: arrStr(json.viralHookPatterns),
      voiceRules: arrStr(json.voiceRules),
      bannedPhrases: arrStr(json.bannedPhrases),
      algoTargets: arrStr(json.algoTargets),
      examples: Array.isArray(json.examples) ? json.examples.filter((e: unknown): e is { hook: string; whyItWorks: string } => typeof (e as { hook?: unknown })?.hook === "string") : [],
      captionStructure: arrStr(json.captionStructure),
    };
  } catch (e) {
    log.warn("playbook", `parse failed, using fallback: ${(e as Error).message}`);
    return FALLBACK;
  }

  await mkdir(path.dirname(PLAYBOOK_PATH), { recursive: true });
  await writeFile(PLAYBOOK_PATH, JSON.stringify(parsed, null, 2));
  log.ok("playbook", `refreshed: ${parsed.viralHookPatterns.length} hooks, ${parsed.bannedPhrases.length} bans, ${parsed.examples.length} examples → ${PLAYBOOK_PATH}`);
  return parsed;
}

function arrStr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 60);
}

export function playbookToPromptBlock(pb: Playbook): string {
  if (!pb.viralHookPatterns.length && !pb.bannedPhrases.length) return "";
  const lines: string[] = [`\nLIVE PLAYBOOK (researched ${pb.generatedAt.slice(0, 10)} for niche=${pb.niche}). USE THESE OVER ANY DEFAULT EXAMPLES BELOW.`];
  if (pb.viralHookPatterns.length) {
    lines.push("\nVIRAL HOOK PATTERNS (current):");
    for (const p of pb.viralHookPatterns) lines.push(`- ${p}`);
  }
  if (pb.voiceRules.length) {
    lines.push("\nCURRENT VOICE RULES:");
    for (const r of pb.voiceRules) lines.push(`- ${r}`);
  }
  if (pb.algoTargets.length) {
    lines.push("\nIG ALGO TARGETS RIGHT NOW (engineer for these):");
    for (const t of pb.algoTargets) lines.push(`- ${t}`);
  }
  if (pb.examples.length) {
    lines.push("\nRECENT VIRAL HOOK EXAMPLES (reverse-engineer the structure, not the topic):");
    for (const e of pb.examples) lines.push(`- "${e.hook}" — ${e.whyItWorks}`);
  }
  if (pb.captionStructure.length) {
    lines.push("\nCAPTION STRUCTURE (current):");
    pb.captionStructure.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  if (pb.bannedPhrases.length) {
    lines.push("\nBANNED PHRASES (current AI-slop / cliche detectors):");
    lines.push(pb.bannedPhrases.join(", "));
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  refreshPlaybook().then((pb) => console.log(JSON.stringify(pb, null, 2)));
}

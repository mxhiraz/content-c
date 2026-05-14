import { readFile } from "node:fs/promises";
import { log } from "../log.js";

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export async function loadVtt(vttPath: string): Promise<TranscriptCue[]> {
  try {
    const raw = await readFile(vttPath, "utf8");
    return parseVtt(raw);
  } catch {
    return [];
  }
}

function parseVtt(vtt: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const lines = vtt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const m = line.match(/(\d{1,2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}\.\d{3})/);
    if (!m) continue;
    const start = parseTimestamp(m[1]!);
    const end = parseTimestamp(m[2]!);
    const text: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const ln = lines[j] ?? "";
      if (ln.trim() === "") break;
      text.push(stripVttTags(ln));
    }
    if (text.length) cues.push({ start, end, text: text.join(" ").trim() });
  }
  return mergeCues(cues);
}

function parseTimestamp(s: string): number {
  const parts = s.split(":");
  let h = 0;
  let m = 0;
  let sec = 0;
  if (parts.length === 3) {
    h = Number(parts[0]);
    m = Number(parts[1]);
    sec = Number(parts[2]);
  } else if (parts.length === 2) {
    m = Number(parts[0]);
    sec = Number(parts[1]);
  } else {
    sec = Number(parts[0]);
  }
  return h * 3600 + m * 60 + sec;
}

function stripVttTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function mergeCues(cues: TranscriptCue[]): TranscriptCue[] {
  // YouTube auto-captions emit overlapping rolling cues. Dedup by exact text + merge contiguous.
  const seen = new Set<string>();
  const out: TranscriptCue[] = [];
  for (const c of cues) {
    const key = c.text;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Find the cue range that best matches a body slide's text/headline.
 * Returns [startSec, endSec] in source-video timeline. Falls back to null when no match.
 */
export function pickWindowForText(cues: TranscriptCue[], queryText: string, segLen: number): { start: number; end: number } | null {
  if (!cues.length) return null;
  const tokens = tokenize(queryText);
  if (!tokens.length) return null;
  const windowSize = Math.max(1, Math.round(segLen / 2));
  // Score sliding windows of cues by token overlap
  let best: { i: number; score: number } | null = null;
  for (let i = 0; i < cues.length; i += 1) {
    const winText = cues.slice(i, i + windowSize).map((c) => c.text).join(" ").toLowerCase();
    let hits = 0;
    for (const t of tokens) {
      if (winText.includes(t)) hits += 1;
    }
    const score = tokens.length ? hits / tokens.length : 0;
    if (!best || score > best.score) best = { i, score };
  }
  if (!best || best.score < 0.18) return null;
  const winStart = cues[best.i]?.start ?? 0;
  const center = winStart;
  return { start: Math.max(0, center - 0.4), end: center + segLen };
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s$%]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
    .slice(0, 15);
}

const STOPWORDS = new Set([
  "this", "that", "with", "from", "have", "will", "they", "them", "what", "when", "where",
  "into", "your", "their", "would", "could", "should", "about", "after", "before", "while",
  "just", "also", "than", "then", "more", "most", "such", "some", "more", "into", "over",
]);

export function logTranscriptSummary(cues: TranscriptCue[]): void {
  if (!cues.length) {
    log.warn("video", "no transcript available; falling back to evenly-spaced windows");
    return;
  }
  log.ok("video", `transcript: ${cues.length} cues, ${cues[cues.length - 1]?.end.toFixed(1)}s total`);
}

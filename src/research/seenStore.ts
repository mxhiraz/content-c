import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const SEEN_PATH = path.join(config.pipeline.outputDir, ".seen.json");

interface SeenEntry {
  id: string;
  url: string;
  title: string;
  seenAt: string;
}

async function load(): Promise<SeenEntry[]> {
  try {
    const raw = await readFile(SEEN_PATH, "utf8");
    return JSON.parse(raw) as SeenEntry[];
  } catch {
    return [];
  }
}

async function save(entries: SeenEntry[]): Promise<void> {
  await mkdir(path.dirname(SEEN_PATH), { recursive: true });
  await writeFile(SEEN_PATH, JSON.stringify(entries, null, 2));
}

export async function getSeenIds(maxAgeDays = 30): Promise<Set<string>> {
  const entries = await load();
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  return new Set(entries.filter((e) => Date.parse(e.seenAt) >= cutoff).map((e) => e.id));
}

export async function markSeen(article: { id: string; url: string; title: string }): Promise<void> {
  const entries = await load();
  if (entries.some((e) => e.id === article.id)) return;
  entries.push({ id: article.id, url: article.url, title: article.title, seenAt: new Date().toISOString() });
  // Keep last 500
  const trimmed = entries.slice(-500);
  await save(trimmed);
}

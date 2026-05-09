import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const STATE_PATH = path.join(config.pipeline.outputDir, ".recent-formats.json");
const KEEP = 4;

export type FormatName =
  | "news_drop"
  | "myth_bust"
  | "stat_stack"
  | "before_after"
  | "insider_pov"
  | "question_hook"
  | "diagram_flow"
  | "receipts";

export const ALL_FORMATS: FormatName[] = [
  "news_drop",
  "myth_bust",
  "stat_stack",
  "before_after",
  "insider_pov",
  "question_hook",
  "diagram_flow",
  "receipts",
];

export async function loadRecentFormats(): Promise<FormatName[]> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    return (JSON.parse(raw) as FormatName[]) ?? [];
  } catch {
    return [];
  }
}

export async function recordFormat(f: FormatName): Promise<void> {
  const cur = await loadRecentFormats();
  const next = [...cur, f].slice(-KEEP);
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(next));
}

export async function pickEligibleFormats(): Promise<FormatName[]> {
  const recent = await loadRecentFormats();
  const eligible = ALL_FORMATS.filter((f) => !recent.includes(f));
  return eligible.length ? eligible : ALL_FORMATS;
}

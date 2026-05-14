// Shared JSON extraction. Used by content/generate.ts (slide spec) and
// research/webSearch.ts (story list). LLM outputs sometimes wrap JSON in markdown
// fences or trail commentary — strip + slice + jsonrepair fallback.

import { jsonrepair } from "jsonrepair";

/** Extract a JSON object/array from LLM output. Throws if no valid JSON found. */
export function extractJson(text: string, label = "llm-output"): unknown {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Direct parse
  try { return JSON.parse(cleaned); } catch { /* try next */ }

  // Slice between first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`${label}: no JSON object in output: ${cleaned.slice(0, 200)}`);
  }
  const sliced = cleaned.slice(start, end + 1);
  try { return JSON.parse(sliced); } catch { /* try repair */ }

  // jsonrepair: trailing commas, unescaped quotes, smart quotes, etc.
  try {
    return JSON.parse(jsonrepair(sliced));
  } catch (e) {
    throw new Error(`${label}: JSON parse failed (even after repair): ${(e as Error).message}\nfirst 300: ${cleaned.slice(0, 300)}`);
  }
}

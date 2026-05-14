// LLM text-generation adapter. Runtime-switchable provider (Claude | Gemini) via config UI.
// Scope: slide-spec generation only. Research + playbook stay on Claude — they need
// Anthropic's web_search_20250305 server tool which Gemini has no clean equivalent for.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { loadDeliveryConfig } from "../delivery/config.js";
import { log } from "../log.js";

export type LlmProvider = "claude" | "gemini";

export interface TextGenOpts {
  system: string;
  user: string;
  maxTokens: number;
  onTextDelta?: (s: string) => void;
}

export interface TextGenResult {
  text: string;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  provider: LlmProvider;
  model: string;
}

interface Runtime {
  provider: LlmProvider;
  anthropicKey: string;
  geminiKey: string;
  geminiTextModel: string;
  claudeModel: string;
}

let _cache: { ts: number; rt: Runtime } | undefined;
let _claude: { key: string; client: Anthropic } | undefined;
let _gemini: { key: string; client: GoogleGenAI } | undefined;

async function getRuntime(): Promise<Runtime> {
  if (_cache && Date.now() - _cache.ts < 5_000) return _cache.rt;
  const cfg = await loadDeliveryConfig().catch(() => null);
  const provider = (cfg?.llmProvider ?? "claude") as LlmProvider;
  const rt: Runtime = {
    provider,
    anthropicKey: config.anthropicApiKey,
    geminiKey: cfg?.geminiApiKey || config.geminiApiKey,
    geminiTextModel: cfg?.geminiTextModel || process.env.GEMINI_TEXT_MODEL || "gemini-3.1-pro-preview",
    claudeModel: config.models.contentModel,
  };
  _cache = { ts: Date.now(), rt };
  return rt;
}

export function invalidateTextGenCache(): void {
  _cache = undefined;
}

export async function getActiveLlmProvider(): Promise<LlmProvider> {
  return (await getRuntime()).provider;
}

function claude(key: string): Anthropic {
  if (!key) throw new Error("ANTHROPIC_API_KEY required for claude provider — set in env");
  if (_claude?.key === key) return _claude.client;
  _claude = { key, client: new Anthropic({ apiKey: key }) };
  return _claude.client;
}

function gemini(key: string): GoogleGenAI {
  if (!key) throw new Error("GEMINI_API_KEY required for gemini provider — set in config UI or env");
  if (_gemini?.key === key) return _gemini.client;
  _gemini = { key, client: new GoogleGenAI({ apiKey: key }) };
  return _gemini.client;
}

export async function generateText(opts: TextGenOpts): Promise<TextGenResult> {
  const rt = await getRuntime();
  if (rt.provider === "gemini") return geminiGenerate(opts, rt);
  return claudeGenerate(opts, rt);
}

async function claudeGenerate(opts: TextGenOpts, rt: Runtime): Promise<TextGenResult> {
  const stream = claude(rt.anthropicKey).messages.stream({
    model: rt.claudeModel,
    max_tokens: opts.maxTokens,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
  });
  let buf = "";
  stream.on("text", (delta) => {
    buf += delta;
    opts.onTextDelta?.(delta);
  });
  const final = await stream.finalMessage();
  const u = final.usage as typeof final.usage & { cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  return {
    text: buf,
    stopReason: final.stop_reason ?? "",
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
    cacheCreate: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    provider: "claude",
    model: rt.claudeModel,
  };
}

async function geminiGenerate(opts: TextGenOpts, rt: Runtime): Promise<TextGenResult> {
  const ai = gemini(rt.geminiKey);
  // Gemini 3.x Pro requires thinking enabled ("This model only works in thinking mode").
  // Thinking eats maxOutputTokens budget — bump to 32k so reasoning + JSON both fit.
  // Use dynamic thinking budget (-1) so model picks just enough reasoning per task.
  const maxOut = Math.max(opts.maxTokens, 32768);
  const isReasoningModel = /^gemini-3/.test(rt.geminiTextModel);
  log.tool("gemini-text", `generate model=${rt.geminiTextModel} max=${maxOut} thinking=${isReasoningModel ? "dynamic" : "default"}`);
  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model: rt.geminiTextModel,
    contents: [
      { role: "user", parts: [{ text: opts.user }] },
    ],
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: maxOut,
      responseModalities: ["TEXT"],
      // -1 = dynamic budget, model picks. Required for gemini-3.x Pro (can't be 0).
      ...(isReasoningModel ? { thinkingConfig: { thinkingBudget: -1 } } : {}),
    } as Record<string, unknown>,
  });
  const candidate = res.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").filter(Boolean).join("") ?? "";
  if (text && opts.onTextDelta) opts.onTextDelta(text);
  const usage = (res as unknown as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
  log.ok("gemini-text", `returned in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${text.length} chars`);
  return {
    text,
    stopReason: candidate?.finishReason ?? "stop",
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    cacheCreate: 0,
    cacheRead: 0,
    provider: "gemini",
    model: rt.geminiTextModel,
  };
}

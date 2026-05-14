// LLM text-generation adapter. Runtime-switchable provider via config UI.
// Providers: claude (Anthropic) | gemini (Google) | openrouter (DeepSeek + others).
// Image generation is separate (src/render/geminiClient.ts) — always Gemini per client direction.
//
// Cost note May 2026: OpenRouter + DeepSeek V3.1 = $0.21/M in, $0.79/M out — ~82% cheaper
// than Claude Sonnet 4.6 ($3/$15) at comparable JSON output quality.

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { config } from "../config.js";
import { loadDeliveryConfig } from "../delivery/config.js";
import { log } from "../log.js";

export type LlmProvider = "claude" | "gemini" | "openrouter";

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
  openrouterKey: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
}

let _cache: { ts: number; rt: Runtime } | undefined;
let _claude: { key: string; client: Anthropic } | undefined;
let _gemini: { key: string; client: GoogleGenAI } | undefined;
let _openrouter: { key: string; baseUrl: string; client: OpenAI } | undefined;

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
    openrouterKey: cfg?.openrouterApiKey || config.openrouterApiKey,
    openrouterModel: cfg?.openrouterModel || config.openrouterModel,
    openrouterBaseUrl: config.openrouterBaseUrl,
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
  if (!key) throw new Error("ANTHROPIC_API_KEY required for claude provider");
  if (_claude?.key === key) return _claude.client;
  _claude = { key, client: new Anthropic({ apiKey: key }) };
  return _claude.client;
}

function gemini(key: string): GoogleGenAI {
  if (!key) throw new Error("GEMINI_API_KEY required for gemini provider");
  if (_gemini?.key === key) return _gemini.client;
  _gemini = { key, client: new GoogleGenAI({ apiKey: key }) };
  return _gemini.client;
}

function openrouter(key: string, baseUrl: string): OpenAI {
  if (!key) throw new Error("OPENROUTER_API_KEY required for openrouter provider");
  if (_openrouter?.key === key && _openrouter.baseUrl === baseUrl) return _openrouter.client;
  _openrouter = {
    key,
    baseUrl,
    client: new OpenAI({
      apiKey: key,
      baseURL: baseUrl,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/ai-carousel-factory",
        "X-Title": "AI Carousel Factory",
      },
    }),
  };
  return _openrouter.client;
}

export async function generateText(opts: TextGenOpts): Promise<TextGenResult> {
  const rt = await getRuntime();
  if (rt.provider === "gemini") return geminiGenerate(opts, rt);
  if (rt.provider === "openrouter") return openrouterGenerate(opts, rt);
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
  // gemini-3.x Pro requires thinking enabled. Thinking eats maxOutputTokens budget —
  // bump to 32k so reasoning + JSON both fit. -1 = dynamic budget.
  const maxOut = Math.max(opts.maxTokens, 32768);
  const isReasoningModel = /^gemini-3/.test(rt.geminiTextModel);
  log.tool("gemini-text", `generate model=${rt.geminiTextModel} max=${maxOut} thinking=${isReasoningModel ? "dynamic" : "default"}`);
  const t0 = Date.now();
  const res = await ai.models.generateContent({
    model: rt.geminiTextModel,
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: maxOut,
      responseModalities: ["TEXT"],
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

async function openrouterGenerate(opts: TextGenOpts, rt: Runtime): Promise<TextGenResult> {
  const client = openrouter(rt.openrouterKey, rt.openrouterBaseUrl);
  log.tool("openrouter", `generate model=${rt.openrouterModel} max=${opts.maxTokens}`);
  const t0 = Date.now();
  const stream = await client.chat.completions.create({
    model: rt.openrouterModel,
    max_tokens: opts.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });
  let buf = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      buf += delta;
      opts.onTextDelta?.(delta);
    }
    const fr = chunk.choices?.[0]?.finish_reason;
    if (fr) stopReason = fr;
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0;
      outputTokens = chunk.usage.completion_tokens ?? 0;
    }
  }
  log.ok("openrouter", `returned in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${buf.length} chars`);
  return {
    text: buf,
    stopReason,
    inputTokens,
    outputTokens,
    cacheCreate: 0,
    cacheRead: 0,
    provider: "openrouter",
    model: rt.openrouterModel,
  };
}

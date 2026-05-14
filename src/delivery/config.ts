import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const CONFIG_PATH = path.join(config.pipeline.outputDir, ".delivery.json");

export type FeedSlot = "viral" | "controversy" | "prompts" | "latest";

export interface DeliveryConfig {
  whatsappGroupName?: string;
  whatsappGroupId?: string;
  emailRecipients?: string[];
  enableWhatsApp: boolean;
  enableEmail: boolean;
  automationEnabled: boolean;
  /** Per-slot feed mapping. Index matches SCHEDULE_CRONS order. Empty array = skip that slot. */
  slotFeeds: FeedSlot[][];
  /** Override env GEMINI_API_KEY at runtime via config UI. Empty = use env. */
  geminiApiKey?: string;
  /** Image model id. "gemini-3-pro-image-preview" (Pro, slower, higher quality)
   *  or "gemini-3.1-flash-image-preview" (Flash, faster, cheaper). Empty = env default. */
  geminiImageModel?: string;
  /** LLM provider for research + slide-spec gen. "claude" | "gemini" | "openrouter".
   *  OpenRouter recommended for cost (DeepSeek V3.1 ~82% cheaper than Claude). */
  llmProvider?: "claude" | "gemini" | "openrouter";
  /** Gemini text model when llmProvider=gemini. e.g. "gemini-3-pro", "gemini-2.5-pro". */
  geminiTextModel?: string;
  /** OpenRouter key override. Empty = use env. */
  openrouterApiKey?: string;
  /** OpenRouter model id, e.g. "deepseek/deepseek-chat-v3.1" or "deepseek/deepseek-r1". */
  openrouterModel?: string;
}

const DEFAULT: DeliveryConfig = {
  enableWhatsApp: false,
  enableEmail: false,
  automationEnabled: false,
  // Default: 5 slots, viral/controversy/latest/prompts/viral
  slotFeeds: [["viral"], ["controversy"], ["latest"], ["prompts"], ["viral"]],
};

export async function loadDeliveryConfig(): Promise<DeliveryConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<DeliveryConfig>) };
  } catch {
    return { ...DEFAULT };
  }
}

export async function saveDeliveryConfig(cfg: Partial<DeliveryConfig>): Promise<DeliveryConfig> {
  const current = await loadDeliveryConfig();
  const next = { ...current, ...cfg };
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

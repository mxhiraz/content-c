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

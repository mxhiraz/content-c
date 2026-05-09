import { fal } from "@fal-ai/client";
import { config } from "../config.js";
import { log } from "../log.js";

let configured = false;

export function getFal() {
  if (!configured) {
    fal.config({ credentials: config.falKey });
    configured = true;
  }
  return fal;
}

export interface FalImageSize {
  width: number;
  height: number;
}

export interface GptImage2Input {
  prompt: string;
  image_size?: FalImageSize | "square" | "landscape_4_3" | "landscape_16_9" | "portrait_4_3" | "portrait_16_9";
  quality?: "low" | "medium" | "high";
  num_images?: number;
  output_format?: "png" | "jpeg" | "webp";
}

export interface GptImage2Output {
  images: { url: string; width: number; height: number; content_type: string; file_name: string }[];
}

export async function gptImage2(input: GptImage2Input): Promise<GptImage2Output> {
  const client = getFal();
  const result = await client.subscribe("openai/gpt-image-2", {
    input,
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_QUEUE") {
        const pos = (update as { queue_position?: number }).queue_position;
        log.tool("fal", `queued${pos !== undefined ? ` (position ${pos})` : ""}`);
      } else if (update.status === "IN_PROGRESS") {
        const logs = (update as { logs?: { message: string }[] }).logs ?? [];
        for (const l of logs) log.tool("fal", l.message);
      }
    },
  });
  return result.data as GptImage2Output;
}

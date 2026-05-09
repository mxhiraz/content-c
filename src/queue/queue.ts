import { Queue, type ConnectionOptions } from "bullmq";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

export const connection: ConnectionOptions = { url: REDIS_URL } as ConnectionOptions;

export const QUEUE_NAME = "carousel";

export interface RenderJob {
  url: string;
  title?: string;
  body?: string;
  source?: string;
  feed?: "viral" | "controversy" | "prompts" | "latest";
  newsworthiness?: number;
  isBreaking?: boolean;
  related_image_urls?: string[];
  related_video_urls?: string[];
  entity_x_handles?: string[];
}

export const carouselQueue = new Queue<RenderJob>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

import { Worker, type Job } from "bullmq";
import { createHash } from "node:crypto";
import { connection, QUEUE_NAME, type RenderJob } from "./queue.js";
import { handleScheduledJob } from "./scheduler.js";
import { log } from "../log.js";
import { generateSlideSpec, InsufficientSourceError } from "../content/generate.js";
import { renderCarousel } from "../render/render.js";
import { recordRendered } from "../research/index.js";
import { dispatchCarousel } from "../delivery/dispatch.js";
import type { Article } from "../types.js";

const BREAKING_THRESHOLD = Number.parseFloat(process.env.BREAKING_THRESHOLD ?? "0.85");

export function startWorker(): Worker<RenderJob> {
  const w = new Worker<RenderJob>(
    QUEUE_NAME,
    async (job: Job<RenderJob>) => {
      // Stale-job guard: skip slot jobs that were scheduled >5 min ago (caught up after a long downtime)
      const isScheduled = job.data.url === "_scheduled" || job.data.url === "_newsletter" || job.name === "newsletter-watch" || job.name.startsWith("slot-");
      if (isScheduled) {
        const ageMs = Date.now() - job.timestamp;
        if (ageMs > 5 * 60_000) {
          log.warn("worker", `skipping stale ${job.name} (age ${(ageMs / 60000).toFixed(1)}min)`);
          return { skipped: "stale", ageMin: Math.round(ageMs / 60000) };
        }
        const slotIdx = (job.data as unknown as { _slotIdx?: number })._slotIdx;
        return await handleScheduledJob(job.name, slotIdx);
      }

      const data = job.data;
      const id = createHash("sha1").update(data.url).digest("hex").slice(0, 16);

      if (data.isBreaking) {
        const score = data.newsworthiness ?? 0;
        if (score < BREAKING_THRESHOLD) {
          return { skipped: "below_breaking_threshold", score, threshold: BREAKING_THRESHOLD };
        }
      }

      const article: Article = {
        id,
        source: data.source ?? new URL(data.url).hostname,
        url: data.url,
        title: data.title ?? data.url,
        body: data.body ?? data.title ?? "",
        publishedAt: new Date(),
        topicScore: data.newsworthiness ?? 1,
        relatedImageUrls: data.related_image_urls,
        relatedVideoUrls: data.related_video_urls,
        entityXHandles: data.entity_x_handles,
      };

      let spec;
      try {
        spec = await generateSlideSpec(article);
      } catch (e) {
        if (e instanceof InsufficientSourceError) return { skipped: "insufficient_source" };
        throw e;
      }

      const out = await renderCarousel(spec);
      await recordRendered(article);
      const sent = await dispatchCarousel({
        carouselDir: out.outputDir,
        hookHeadline: spec.hook_slide.headline,
        caption: spec.instagram_caption,
        feed: data.feed,
        sourceUrl: spec.source_url,
      });
      return { rendered: true, outputDir: out.outputDir, feed: data.feed ?? "viral", sent };
    },
    { connection, concurrency: Number.parseInt(process.env.WORKER_CONCURRENCY ?? "1", 10) }
  );

  w.on("completed", (job, result) => log.ok("worker", `job ${job.id} ${JSON.stringify(result).slice(0, 200)}`));
  w.on("failed", (job, err) => log.err("worker", `job ${job?.id} failed: ${err?.message}`));
  w.on("error", (err) => log.err("worker", `error: ${err.message}`));
  log.ok("worker", `bullmq worker started, concurrency=2, queue=${QUEUE_NAME}`);
  return w;
}

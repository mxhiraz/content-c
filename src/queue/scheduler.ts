import { carouselQueue } from "./queue.js";
import { researchTopArticles } from "../research/index.js";
import { loadDeliveryConfig } from "../delivery/config.js";
import { ALL_FEEDS } from "../research/feeds.js";
import { pollNewsletters } from "./newsletterWatch.js";
import { log } from "../log.js";

const SCHEDULE_CRONS = (process.env.SCHEDULE_CRONS ?? "53 12 * * *,53 14 * * *,38 17 * * *,38 18 * * *,23 19 * * *").split(",").map((s) => s.trim()).filter(Boolean);
const SCHEDULE_TZ = process.env.SCHEDULE_TZ ?? "Asia/Kolkata";
// Newsletter poll interval. Default = 6h. Newsletters are human-curated so already filtered for "hot".
const NEWSLETTER_INTERVAL = process.env.NEWSLETTER_INTERVAL ?? "0 */6 * * *";

/**
 * Register repeatable jobs for daily slots + breaking-news watcher.
 * Drains stale queued jobs on every restart so missed slots don't backfill.
 */
export async function registerSchedules(): Promise<void> {
  // 1. Remove old repeatable definitions
  const existing = await carouselQueue.getRepeatableJobs();
  for (const r of existing) {
    await carouselQueue.removeRepeatableByKey(r.key);
  }

  // 2. Drain delayed + waiting jobs (stale slots from previous runs that would fire now)
  const delayed = await carouselQueue.getJobs(["delayed", "waiting", "paused"]);
  for (const j of delayed) {
    try { await j.remove(); } catch { /* ignore */ }
  }
  log.info("scheduler", `cleared ${existing.length} repeatables + ${delayed.length} stale queued jobs`);

  for (let i = 0; i < SCHEDULE_CRONS.length; i += 1) {
    const cron = SCHEDULE_CRONS[i]!;
    await carouselQueue.add(
      `slot-${i + 1}`,
      { url: "_scheduled", _slotIdx: i } as unknown as Parameters<typeof carouselQueue.add>[1],
      {
        repeat: { pattern: cron, tz: SCHEDULE_TZ },
        jobId: `repeat:slot-${i + 1}`,
      }
    );
    log.ok("scheduler", `registered slot ${i + 1}: ${cron} (${SCHEDULE_TZ})`);
  }

  await carouselQueue.add(
    "newsletter-watch",
    { url: "_newsletter" } as unknown as Parameters<typeof carouselQueue.add>[1],
    {
      repeat: { pattern: NEWSLETTER_INTERVAL, tz: SCHEDULE_TZ },
      jobId: "repeat:newsletter",
    }
  );
  log.ok("scheduler", `registered newsletter watcher: ${NEWSLETTER_INTERVAL} (${SCHEDULE_TZ})`);
}

/**
 * Worker handler delegates "_scheduled" / "_breaking" placeholder jobs to research+enqueue.
 * Real render jobs (real URLs) are processed directly by the worker.
 * This file exposes a hook for the worker to call.
 */
export async function handleScheduledJob(jobName: string, slotIdx?: number): Promise<{ enqueued: number; skipped?: string }> {
  const cfg = await loadDeliveryConfig();
  if (!cfg.automationEnabled) return { enqueued: 0, skipped: "automation_disabled" };

  if (jobName === "newsletter-watch") {
    const r = await pollNewsletters();
    return { enqueued: r.enqueued };
  }

  if (typeof slotIdx === "number") {
    const slotFeeds = (cfg.slotFeeds && cfg.slotFeeds[slotIdx]) || ALL_FEEDS;
    if (!slotFeeds.length) return { enqueued: 0, skipped: "no_feeds_for_slot" };
    let count = 0;
    for (const feed of slotFeeds) {
      const articles = await researchTopArticles({ feed, limit: 1, skipSeen: true });
      for (const a of articles) {
        await carouselQueue.add("render", {
          url: a.url,
          title: a.title,
          body: a.body,
          source: a.source,
          feed,
          newsworthiness: a.topicScore,
          related_image_urls: a.relatedImageUrls,
          related_video_urls: a.relatedVideoUrls,
          entity_x_handles: a.entityXHandles,
        });
        count += 1;
      }
    }
    return { enqueued: count };
  }

  return { enqueued: 0, skipped: "unknown_job" };
}

import { carouselQueue } from "./queue.js";
import { researchTopArticles } from "../research/index.js";
import { loadDeliveryConfig } from "../delivery/config.js";
import { ALL_FEEDS } from "../research/feeds.js";
import { log } from "../log.js";

// 5 daily slot crons only (no newsletter watcher, no heartbeat — per client May 2026).
const SCHEDULE_CRONS = (process.env.SCHEDULE_CRONS ?? "53 12 * * *,53 14 * * *,38 17 * * *,38 18 * * *,23 19 * * *").split(",").map((s) => s.trim()).filter(Boolean);
const SCHEDULE_TZ = process.env.SCHEDULE_TZ ?? "Asia/Kolkata";

/**
 * Register the 5 daily slot crons. Drains stale queued jobs on restart
 * so missed slots don't backfill.
 */
export async function registerSchedules(): Promise<void> {
  // 1. Remove old repeatable definitions (incl. any legacy newsletter/heartbeat).
  const existing = await carouselQueue.getRepeatableJobs();
  for (const r of existing) {
    await carouselQueue.removeRepeatableByKey(r.key);
  }

  // 2. Drain delayed + waiting jobs (stale slots that would fire now).
  const delayed = await carouselQueue.getJobs(["delayed", "waiting", "paused"]);
  for (const j of delayed) {
    try { await j.remove(); } catch { /* ignore */ }
  }
  log.info("scheduler", `cleared ${existing.length} repeatables + ${delayed.length} stale queued jobs`);

  // 3. Register the 5 daily slots.
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
}

/**
 * Worker handler: turns "_scheduled" placeholder jobs into real render jobs
 * by running research for the slot's feeds + enqueuing each picked article.
 */
export async function handleScheduledJob(_jobName: string, slotIdx?: number): Promise<{ enqueued: number; skipped?: string }> {
  const cfg = await loadDeliveryConfig();
  if (!cfg.automationEnabled) return { enqueued: 0, skipped: "automation_disabled" };

  if (typeof slotIdx !== "number") return { enqueued: 0, skipped: "unknown_job" };

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

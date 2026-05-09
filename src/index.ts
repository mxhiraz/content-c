import { config } from "./config.js";
import { log } from "./log.js";
import { researchTopArticles, recordRendered } from "./research/index.js";
import { generateSlideSpec, InsufficientSourceError } from "./content/generate.js";
import { renderCarousel } from "./render/render.js";
import type { Article } from "./types.js";

import { ALL_FEEDS, type FeedKind } from "./research/feeds.js";

interface CliOpts {
  storyIndex?: number;
  limit?: number;
  skipSeen: boolean;
  feeds: FeedKind[];
  watchMs?: number;
}

function parseInterval(s: string): number | null {
  const m = s.match(/^(\d+)(s|m|h|d)?$/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? "m";
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}

function parseCli(argv: string[]): CliOpts {
  const opts: CliOpts = { skipSeen: true, feeds: ["viral"] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--index" || a === "--story-index") {
      const v = argv[i + 1];
      if (v) {
        opts.storyIndex = Number.parseInt(v, 10);
        i += 1;
      }
    } else if (a === "--limit") {
      const v = argv[i + 1];
      if (v) {
        opts.limit = Number.parseInt(v, 10);
        i += 1;
      }
    } else if (a === "--feed" || a === "--feeds") {
      const v = argv[i + 1];
      if (v) {
        const list = v.split(",").map((s) => s.trim()).filter(Boolean) as FeedKind[];
        const valid = list.filter((f) => ALL_FEEDS.includes(f));
        if (valid.length) opts.feeds = valid;
        i += 1;
      }
    } else if (a === "--all-feeds") {
      opts.feeds = [...ALL_FEEDS];
    } else if (a === "--watch") {
      const v = argv[i + 1];
      if (v) {
        const ms = parseInterval(v);
        if (ms) opts.watchMs = ms;
        i += 1;
      } else {
        opts.watchMs = 15 * 60_000;
      }
    } else if (a === "--no-skip-seen" || a === "--allow-seen") {
      opts.skipSeen = false;
    } else if (a === "--reset-seen") {
      opts.skipSeen = false;
    }
  }
  // Env fallback
  if (opts.storyIndex === undefined && process.env.STORY_INDEX) {
    const n = Number.parseInt(process.env.STORY_INDEX, 10);
    if (Number.isFinite(n)) opts.storyIndex = n;
  }
  if (process.env.FEED) {
    const list = process.env.FEED.split(",").map((s) => s.trim()).filter(Boolean) as FeedKind[];
    const valid = list.filter((f) => ALL_FEEDS.includes(f));
    if (valid.length) opts.feeds = valid;
  }
  return opts;
}

async function runOnce(cli: CliOpts): Promise<{ done: number; total: number }> {
  const t0 = Date.now();
  const limit = cli.limit ?? config.pipeline.maxArticlesPerRun;
  log.step("pipeline", `start: feeds=[${cli.feeds.join(",")}] top ${limit}/feed last ${config.pipeline.lookbackHours}h${cli.storyIndex !== undefined ? ` (pinned index=${cli.storyIndex})` : ""}${cli.skipSeen ? " (skip seen)" : " (allow seen)"}`);

  let done = 0;
  let total = 0;
  for (const feed of cli.feeds) {
    log.step("pipeline", `=== FEED: ${feed.toUpperCase()} ===`);
    const articles = await researchTopArticles({
      limit,
      storyIndex: cli.storyIndex,
      skipSeen: cli.skipSeen,
      feed,
    });
    if (articles.length === 0) {
      log.warn("pipeline", `[${feed}] no articles. skip.`);
      continue;
    }
    log.ok("pipeline", `[${feed}] ranked ${articles.length} candidates`);
    for (const a of articles) {
      log.info("pipeline", `  [${a.topicScore.toFixed(2)}] (${a.source}) ${a.title}`);
    }
    total += articles.length;
    for (const article of articles) {
      try {
        await runOne(article);
        await recordRendered(article);
        done += 1;
      } catch (e) {
        log.err("pipeline", `[${feed}] failed on "${article.title}": ${(e as Error).message}`);
      }
    }
  }

  log.ok("pipeline", `pass done: ${done}/${total} carousels across ${cli.feeds.length} feed(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { done, total };
}

function fmtInterval(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (!cli.watchMs) {
    await runOnce(cli);
    return;
  }
  log.step("pipeline", `WATCH MODE: every ${fmtInterval(cli.watchMs)} (Ctrl+C to stop)`);
  const stopped = { value: false };
  const onSig = () => {
    if (stopped.value) process.exit(0);
    stopped.value = true;
    log.warn("pipeline", "stop signal received, finishing current pass then exit");
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  for (let pass = 1; !stopped.value; pass += 1) {
    log.step("pipeline", `--- pass #${pass} ---`);
    try {
      await runOnce(cli);
    } catch (e) {
      log.err("pipeline", `pass #${pass} crashed: ${(e as Error).message}`);
    }
    if (stopped.value) break;
    log.info("pipeline", `next pass in ${fmtInterval(cli.watchMs)}`);
    await new Promise((r) => setTimeout(r, cli.watchMs));
  }
}

async function runOne(article: Article): Promise<void> {
  log.step(article.id, `→ ${article.title}`);
  let spec;
  try {
    spec = await generateSlideSpec(article);
  } catch (e) {
    if (e instanceof InsufficientSourceError) {
      log.warn(article.id, "skipped: insufficient source material");
      return;
    }
    throw e;
  }
  log.info(article.id, `hook: "${spec.hook_slide.headline}"`);
  const out = await renderCarousel(spec);
  log.ok(article.id, `done → ${out.outputDir}`);
}

main().catch((e) => {
  log.err("pipeline", String(e));
  process.exit(1);
});

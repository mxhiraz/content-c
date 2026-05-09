import { spawn, execSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { log } from "../log.js";
import { downloadTweetVideo, parseStatusId } from "./xSyndication.js";
import { downloadRedditVideo, isRedditUrl } from "./redditVideo.js";

export interface SourceVideoOpts {
  outPath: string;
  maxSeconds?: number;
  width?: number;
  height?: number;
}

const VIDEO_HOST_RE = /(youtube\.com|youtu\.be|twitter\.com|x\.com|t\.co|reddit\.com|v\.redd\.it|vimeo\.com|loom\.com|tiktok\.com)/i;

const VIDEO_PATH_RE = [
  /youtube\.com\/watch\?v=/i,
  /youtu\.be\/[\w-]+/i,
  /youtube\.com\/shorts\/[\w-]+/i,
  /(twitter|x)\.com\/[^/]+\/status\/\d+/i,
  /reddit\.com\/r\/[^/]+\/comments\/[\w-]+/i,
  /v\.redd\.it\/[\w-]+/i,
  /vimeo\.com\/\d+/i,
  /loom\.com\/share\/[\w-]+/i,
  /tiktok\.com\/[^/]+\/video\/\d+/i,
];

function isLikelyVideoUrl(url: string): boolean {
  return VIDEO_PATH_RE.some((re) => re.test(url));
}

export async function extractSourceVideo(sourceUrl: string, opts: SourceVideoOpts): Promise<string | null> {
  // X/Twitter direct URL → use syndication endpoint (no auth, no yt-dlp needed)
  const directTweetId = parseStatusId(sourceUrl);
  if (directTweetId) {
    const got = await downloadTweetVideo(directTweetId, opts.outPath, opts.maxSeconds ?? 12);
    if (got) return got;
  }

  // Reddit direct URL → .json + ffmpeg mux (no auth, no yt-dlp)
  if (isRedditUrl(sourceUrl)) {
    const got = await downloadRedditVideo(sourceUrl, opts.outPath, opts.maxSeconds ?? 12);
    if (got) return got;
  }

  if (!hasYtDlp()) {
    log.warn("video", "yt-dlp not installed; skipping source video. brew install yt-dlp");
    return null;
  }

  const candidates = await findVideoUrls(sourceUrl);
  if (!candidates.length) {
    log.warn("video", `no video URL found in ${sourceUrl}`);
    return null;
  }

  // Try syndication first for any X/Twitter status URLs in candidates
  for (const cand of candidates) {
    const id = parseStatusId(cand);
    if (id) {
      const got = await downloadTweetVideo(id, opts.outPath, opts.maxSeconds ?? 12);
      if (got) return got;
    }
  }

  const validCands = candidates.filter((c) => isLikelyVideoUrl(c) || /\.(mp4|webm|m3u8)(\?|$)/i.test(c));
  if (validCands.length < candidates.length) {
    log.warn("video", `dropped ${candidates.length - validCands.length} non-video URLs (homepage/profile/search)`);
  }
  if (!validCands.length) {
    log.warn("video", `no valid video URL pattern in candidates`);
    return null;
  }

  for (const cand of validCands) {
    log.tool("video", `yt-dlp → ${cand.slice(0, 80)}`);
    try {
      const tmp = `${opts.outPath}.raw.mp4`;
      await runYtDlp(cand, tmp);
      const st = await stat(tmp).catch(() => null);
      if (!st || st.size < 50_000) {
        log.warn("video", `download too small (${st?.size ?? 0}B), trying next`);
        continue;
      }
      await transcodeFor9x16(tmp, opts.outPath, opts.maxSeconds ?? 12, opts.width ?? 1080, opts.height ?? 1350);
      log.ok("video", `source clip ready → ${opts.outPath}`);
      return opts.outPath;
    } catch (e) {
      log.warn("video", `yt-dlp failed: ${(e as Error).message}`);
    }
  }
  return null;
}

async function findVideoUrls(sourceUrl: string): Promise<string[]> {
  const out: string[] = [];
  if (VIDEO_HOST_RE.test(sourceUrl)) out.push(sourceUrl);

  // Static HTML scrape
  let html = "";
  try {
    html = await (await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" },
      signal: AbortSignal.timeout(15_000),
    })).text();
    extractStaticVideoUrls(html, out);
  } catch {
    // best-effort
  }

  // Browser-rendered scrape if static found nothing useful and BROWSER_SCRAPE=true
  if (out.length === 0 && (process.env.BROWSER_SCRAPE ?? "").toLowerCase() === "true") {
    try {
      const fromBrowser = await scrapeWithBrowser(sourceUrl);
      out.push(...fromBrowser);
    } catch (e) {
      log.warn("video", `browser scrape failed: ${(e as Error).message}`);
    }
  }

  return Array.from(new Set(out)).slice(0, 5);
}

function extractStaticVideoUrls(html: string, out: string[]): void {
  const meta = (prop: string): string | undefined => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}["'][^>]+content=["']([^"']+)["']`, "i"));
    return m?.[1];
  };
  const push = (u: string | undefined) => {
    if (u) out.push(u.startsWith("//") ? `https:${u}` : u);
  };
  push(meta("og:video"));
  push(meta("og:video:url"));
  push(meta("og:video:secure_url"));
  push(meta("twitter:player:stream"));
  push(meta("twitter:player"));

  // <video src> and <source src>
  for (const m of html.matchAll(/<(?:video|source)[^>]+src=["']([^"']+\.(?:mp4|webm|m3u8))(?:\?[^"']*)?["']/gi)) {
    if (m[1]) out.push(m[1]);
  }

  // iframe embeds (YouTube/Vimeo/Loom/Twitter)
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
    const src = m[1];
    if (src && VIDEO_HOST_RE.test(src)) out.push(src.startsWith("//") ? `https:${src}` : src);
  }

  // anchor links to video hosts
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (href && VIDEO_HOST_RE.test(href)) out.push(href);
  }

  // JSON-LD VideoObject
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(m[1] ?? "");
      const items = Array.isArray(json) ? json : [json];
      for (const it of items) collectJsonLdVideo(it, out);
    } catch {
      // ignore malformed JSON-LD
    }
  }
}

function collectJsonLdVideo(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const r = node as Record<string, unknown>;
  if (typeof r.contentUrl === "string") out.push(r.contentUrl);
  if (typeof r.embedUrl === "string") out.push(r.embedUrl);
  for (const v of Object.values(r)) {
    if (v && typeof v === "object") collectJsonLdVideo(v, out);
  }
}

async function scrapeWithBrowser(sourceUrl: string): Promise<string[]> {
  let mod: { chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> } } | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mod = (await import("playwright" as any)) as any;
  } catch {
    log.warn("video", "playwright not installed; skipping browser scrape. npm i playwright && npx playwright install chromium");
    return [];
  }
  if (!mod) return [];
  log.tool("video", `browser-rendering ${sourceUrl}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const browser: any = await mod.chromium.launch({ headless: true });
  const out: string[] = [];
  try {
    const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15" });
    const page = await ctx.newPage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on("response", (resp: any) => {
      const url = resp.url() as string;
      if (/\.(mp4|webm|m3u8)(\?|$)/i.test(url)) out.push(url);
    });
    await page.goto(sourceUrl, { timeout: 25_000, waitUntil: "networkidle" }).catch(() => undefined);
    await page.waitForTimeout(2000);
    const dom: string[] = await page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll("video, source").forEach((el) => {
        const src = (el as HTMLMediaElement).src || el.getAttribute("src");
        if (src) urls.push(src);
      });
      document.querySelectorAll("iframe").forEach((el) => {
        const src = (el as HTMLIFrameElement).src;
        if (src) urls.push(src);
      });
      return urls;
    });
    out.push(...dom);
  } finally {
    await browser.close();
  }
  log.ok("video", `browser found ${out.length} video URLs`);
  return out.filter((u) => /\.(mp4|webm|m3u8)(\?|$)/i.test(u) || VIDEO_HOST_RE.test(u));
}

function hasYtDlp(): boolean {
  try {
    execSync("which yt-dlp", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function runYtDlp(url: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-f", "best[ext=mp4][height<=1080]/best[height<=1080]/best",
      "--max-filesize", "150M",
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "20",
      "--retries", "1",
      "--write-auto-subs",
      "--write-subs",
      "--sub-langs", "en.*,en",
      "--sub-format", "vtt",
      "--convert-subs", "vtt",
      "-o", outPath,
      url,
    ];
    const p = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    const killTimer = setTimeout(() => {
      log.warn("video", `yt-dlp ${url.slice(0, 50)} timed out after 60s, killing`);
      p.kill("SIGKILL");
    }, 60_000);
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => {
      clearTimeout(killTimer);
      reject(e);
    });
    p.on("exit", (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exit ${code}: ${err.slice(-300)}`));
    });
  });
}

function transcodeFor9x16(input: string, output: string, maxSec: number, w: number, h: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i", input,
      "-t", String(maxSec),
      "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`,
      "-r", "30",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "veryfast",
      "-crf", "20",
      "-movflags", "+faststart",
      "-an",
      output,
    ];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg transcode exit ${code}: ${err.slice(-300)}`))));
  });
}

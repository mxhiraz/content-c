import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { log } from "../log.js";
import { downloadTweetVideo } from "./xSyndication.js";

const NITTER_INSTANCES = (process.env.NITTER_INSTANCES ?? "nitter.net,nitter.poast.org,nitter.privacydev.net,nitter.kavin.rocks").split(",").map((s) => s.trim()).filter(Boolean);

interface NitterPost {
  url: string;
  title: string;
  pubDate: Date;
  hasVideo: boolean;
}

export async function fetchXHandleVideo(handle: string, headline: string, outPath: string): Promise<string | null> {
  const cleaned = handle.replace(/^@/, "").trim();
  if (!cleaned) return null;
  log.tool("video", `x-handle scrape: @${cleaned}`);
  const posts = await fetchRecentPosts(cleaned);
  if (!posts.length) {
    log.warn("video", `no posts for @${cleaned}`);
    return null;
  }
  const ranked = rankByMatch(posts, headline);
  for (const p of ranked.slice(0, 4)) {
    const tweetId = extractStatusId(p.url);
    if (!tweetId) continue;
    // Try syndication first (free, no auth, fast)
    const synOk = await downloadTweetVideo(tweetId, outPath, 12);
    if (synOk) return synOk;
    // Fallback: yt-dlp on x.com URL
    const xUrl = `https://x.com/${cleaned}/status/${tweetId}`;
    log.tool("video", `syndication empty, try yt-dlp on ${xUrl.slice(0, 80)}`);
    const ok = await ytDlpDownload(xUrl, `${outPath}.raw.mp4`);
    if (!ok) continue;
    const st = await stat(`${outPath}.raw.mp4`).catch(() => null);
    if (!st || st.size < 50_000) continue;
    await transcodeFor4x5(`${outPath}.raw.mp4`, outPath, 12, 1080, 1350);
    log.ok("video", `x-handle clip ready (yt-dlp) -> ${outPath}`);
    return outPath;
  }
  return null;
}

function extractStatusId(url: string): string | null {
  const m = url.match(/\/status\/(\d+)/);
  return m?.[1] ?? null;
}

async function fetchRecentPosts(handle: string): Promise<NitterPost[]> {
  for (const inst of NITTER_INSTANCES) {
    try {
      const url = `https://${inst}/${handle}/rss`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 ai-carousel" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        log.warn("video", `nitter ${inst} HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const posts = parseRss(xml);
      if (posts.length > 0) {
        log.ok("video", `nitter ${inst}: ${posts.length} posts`);
        return posts;
      }
    } catch (e) {
      log.warn("video", `nitter ${inst} failed: ${(e as Error).message}`);
    }
  }
  return [];
}

function parseRss(xml: string): NitterPost[] {
  const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  const out: NitterPost[] = [];
  for (const it of items) {
    const block = it[1] ?? "";
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ?? "";
    const title = decodeXml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "");
    const pubDateStr = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
    const desc = block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "";
    const hasVideo = /<video[ >]/i.test(desc) || /\.mp4|\.webm/i.test(desc) || /video/i.test(desc);
    if (!link) continue;
    out.push({ url: link, title, pubDate: new Date(pubDateStr || Date.now()), hasVideo });
  }
  return out.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime()).slice(0, 30);
}

function rankByMatch(posts: NitterPost[], headline: string): NitterPost[] {
  const tokens = headline.toLowerCase().split(/\W+/).filter((t) => t.length >= 4);
  const scored = posts.map((p) => {
    const t = p.title.toLowerCase();
    const overlap = tokens.filter((tok) => t.includes(tok)).length;
    const recencyDays = (Date.now() - p.pubDate.getTime()) / 86_400_000;
    const recencyScore = Math.max(0, 14 - recencyDays) / 14;
    const videoBoost = p.hasVideo ? 1 : 0.4;
    return { p, score: overlap * 2 + recencyScore + videoBoost };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.p);
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function ytDlpDownload(url: string, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      "-f", "best[ext=mp4][height<=1080]/best[height<=1080]/best",
      "--max-filesize", "120M",
      "--no-warnings",
      "--no-playlist",
      "-o", outPath,
      url,
      "--quiet",
    ];
    const p = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

function transcodeFor4x5(input: string, output: string, maxSec: number, w: number, h: number): Promise<void> {
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
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`))));
  });
}

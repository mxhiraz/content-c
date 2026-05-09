import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { log } from "../log.js";

export function parseStatusId(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  return m?.[1] ?? null;
}

export async function fetchTweetVideoUrl(tweetId: string): Promise<string | null> {
  const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${token}`;
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      log.warn("video", `x-syndication HTTP ${r.status} for tweet ${tweetId}`);
      return null;
    }
    const j = (await r.json()) as { mediaDetails?: { video_info?: { variants?: { content_type: string; bitrate?: number; url: string }[] } }[] };
    const variants = j?.mediaDetails?.[0]?.video_info?.variants ?? [];
    const mp4s = variants.filter((v) => v.content_type === "video/mp4");
    mp4s.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    return mp4s[0]?.url ?? null;
  } catch (e) {
    log.warn("video", `x-syndication failed for ${tweetId}: ${(e as Error).message}`);
    return null;
  }
}

export async function downloadTweetVideo(tweetId: string, outPath: string, maxSec = 12): Promise<string | null> {
  const directUrl = await fetchTweetVideoUrl(tweetId);
  if (!directUrl) return null;
  log.tool("video", `x-syndication: tweet ${tweetId} -> ${directUrl.slice(0, 80)}`);
  try {
    const r = await fetch(directUrl, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) {
      log.warn("video", `x video HTTP ${r.status}`);
      return null;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 50_000) {
      log.warn("video", `x video too small: ${buf.length}B`);
      return null;
    }
    const tmp = `${outPath}.raw.mp4`;
    await writeFile(tmp, buf);
    await transcodeFor4x5(tmp, outPath, maxSec, 1080, 1350);
    log.ok("video", `x-syndication clip ready -> ${outPath}`);
    return outPath;
  } catch (e) {
    log.warn("video", `x-syndication download failed: ${(e as Error).message}`);
    return null;
  }
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

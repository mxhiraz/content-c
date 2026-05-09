import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { log } from "../log.js";

export function isRedditUrl(url: string): boolean {
  return /reddit\.com\/r\/[^/]+\/comments\/|v\.redd\.it\//i.test(url);
}

export async function downloadRedditVideo(permalink: string, outPath: string, maxSec = 12): Promise<string | null> {
  try {
    const jsonUrl = permalink.replace(/\/?$/, "/.json");
    const r = await fetch(jsonUrl, {
      headers: { "user-agent": "ai-carousel-factory/0.1" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      log.warn("video", `reddit json HTTP ${r.status}`);
      return null;
    }
    const j = (await r.json()) as Array<{ data: { children: Array<{ data: { secure_media?: { reddit_video?: { fallback_url: string; hls_url?: string } } } }> } }>;
    const v = j[0]?.data?.children?.[0]?.data?.secure_media?.reddit_video;
    if (!v) {
      log.warn("video", "reddit post has no reddit_video");
      return null;
    }
    log.tool("video", `reddit fallback: ${v.fallback_url.slice(0, 80)}`);

    // fallback_url = video-only mp4. Audio at <baseUrl>/DASH_AUDIO_128.mp4 (try several variants)
    const base = v.fallback_url.split(/\/DASH_/)[0];
    const audioUrls = [`${base}/DASH_AUDIO_128.mp4`, `${base}/DASH_AUDIO_64.mp4`, `${base}/audio`];
    const videoBuf = await fetchOk(v.fallback_url);
    if (!videoBuf) return null;
    let audioBuf: Buffer | null = null;
    for (const a of audioUrls) {
      audioBuf = await fetchOk(a);
      if (audioBuf) break;
    }
    const tmpVideo = `${outPath}.video.mp4`;
    await writeFile(tmpVideo, videoBuf);
    let muxed = tmpVideo;
    if (audioBuf) {
      const tmpAudio = `${outPath}.audio.mp4`;
      await writeFile(tmpAudio, audioBuf);
      const muxOut = `${outPath}.muxed.mp4`;
      await ffmpegMux(tmpVideo, tmpAudio, muxOut);
      muxed = muxOut;
    }
    await transcodeFor4x5(muxed, outPath, maxSec, 1080, 1350);
    log.ok("video", `reddit clip ready -> ${outPath}`);
    return outPath;
  } catch (e) {
    log.warn("video", `reddit failed: ${(e as Error).message}`);
    return null;
  }
}

async function fetchOk(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 5_000) return null;
    return buf;
  } catch {
    return null;
  }
}

function ffmpegMux(video: string, audio: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", video, "-i", audio, "-c", "copy", "-shortest", output];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`mux exit ${code}: ${err.slice(-200)}`))));
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

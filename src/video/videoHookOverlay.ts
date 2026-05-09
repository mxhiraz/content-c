import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { log } from "../log.js";

export interface VideoOverlayOpts {
  sourceVideoPath: string;
  overlayPng: Buffer;
  outPath: string;
  durationSec?: number;
  startSec?: number;
  width?: number;
  height?: number;
  cropMode?: "full" | "top-half";
}

export async function videoHookOverlay(opts: VideoOverlayOpts): Promise<void> {
  const dur = opts.durationSec ?? 8;
  const start = opts.startSec ?? 0;
  const w = opts.width ?? 1080;
  const h = opts.height ?? 1350;
  const overlayPath = path.join(path.dirname(opts.outPath), `.overlay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  await writeFile(overlayPath, opts.overlayPng);
  const t0 = Date.now();
  log.tool("video", `overlay text → source video, ${w}x${h} ${dur}s, start=${start.toFixed(1)}s, mode=${opts.cropMode ?? "full"}`);

  let bgFilter: string;
  if (opts.cropMode === "top-half") {
    // Source video plays in top half; bottom half is filled black (the overlay PNG holds the text panel)
    const halfH = Math.round(h / 2);
    bgFilter = `[0:v]scale=${w}:${halfH}:force_original_aspect_ratio=increase,crop=${w}:${halfH},setsar=1,fps=30,pad=${w}:${h}:0:0:black[bg]`;
  } else {
    bgFilter = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30[bg]`;
  }

  const args = [
    "-y",
    "-ss", start.toFixed(2),
    "-stream_loop", "-1",
    "-i", opts.sourceVideoPath,
    "-i", overlayPath,
    "-filter_complex",
    `${bgFilter};[bg][1:v]overlay=0:0:format=auto`,
    "-t", String(dur),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "veryfast",
    "-crf", "20",
    "-movflags", "+faststart",
    "-an",
    opts.outPath,
  ];
  try {
    await runFfmpeg(args);
    log.ok("video", `clip ready in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${opts.outPath}`);
  } finally {
    await unlink(overlayPath).catch(() => undefined);
  }
}

export const videoBodyOverlay = videoHookOverlay;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`))));
  });
}

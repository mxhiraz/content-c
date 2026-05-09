import { spawn } from "node:child_process";
import { log } from "../log.js";

export interface ExtractFramesOpts {
  count?: number;
  startSec?: number;
  endSec?: number;
}

export async function extractVideoFrames(videoPath: string, opts: ExtractFramesOpts = {}): Promise<Buffer[]> {
  const count = opts.count ?? 5;
  const dur = await probeDuration(videoPath);
  const start = opts.startSec ?? Math.min(1, dur * 0.05);
  const end = opts.endSec ?? Math.max(start + 1, dur * 0.95);
  const span = Math.max(0.5, end - start);

  log.tool("video", `extracting ${count} frames from ${videoPath} (${dur.toFixed(1)}s)`);
  const buffers: Buffer[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = start + (span * i) / Math.max(1, count - 1);
    try {
      const buf = await frameAt(videoPath, t);
      buffers.push(buf);
    } catch (e) {
      log.warn("video", `frame at ${t.toFixed(1)}s failed: ${(e as Error).message}`);
    }
  }
  log.ok("video", `extracted ${buffers.length}/${count} frames`);
  return buffers;
}

function frameAt(videoPath: string, timeSec: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = [
      "-ss", timeSec.toFixed(2),
      "-i", videoPath,
      "-frames:v", "1",
      "-f", "image2",
      "-c:v", "png",
      "-loglevel", "error",
      "pipe:1",
    ];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c) => chunks.push(Buffer.from(c)));
    p.stderr.on("data", (c) => (err += c.toString()));
    p.on("error", reject);
    p.on("exit", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg frame exit ${code}: ${err.slice(-200)}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

function probeDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath];
    const p = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.on("error", () => resolve(10));
    p.on("exit", () => {
      const v = parseFloat(out.trim());
      resolve(Number.isFinite(v) && v > 0 ? v : 10);
    });
  });
}

import { spawn, execSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { log } from "../log.js";

// Comma-separated env var. Lowercase, no @ prefix. Default = AI niche; swap for other niches.
const OFFICIAL_CHANNELS_ENV = process.env.YOUTUBE_OFFICIAL_CHANNELS ?? "openai,anthropic,anthropicai,google,googledeepmind,deepmind,meta,metaai,ai at meta,nvidia,tesla,x.ai,mistral,mistralai,huggingface,cohere,microsoft,apple,boston dynamics,figureai,bbcnews,reuters,associated press,ap,techcrunch,theverge,bloomberg,wsj,the wall street journal,the new york times";
const OFFICIAL_CHANNELS = new Set(
  OFFICIAL_CHANNELS_ENV.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
);

interface YtCandidate {
  id: string;
  title: string;
  channel: string;
  channel_id?: string;
  upload_date: string; // YYYYMMDD
  duration: number;
  view_count?: number;
  webpage_url: string;
}

export async function searchYouTubeVideo(query: string, outPath: string, maxSeconds = 12, storyDate = new Date()): Promise<string | null> {
  if (!hasYtDlp()) {
    log.warn("video", "yt-dlp not installed; cannot search YouTube. brew install yt-dlp");
    return null;
  }

  const sinceDate = new Date(storyDate.getTime() - 14 * 86_400_000);
  const sinceYmd = sinceDate.toISOString().slice(0, 10).replace(/-/g, "");
  log.tool("video", `yt-dlp ytsearchdate20: "${query}" since ${sinceYmd}`);

  const candidates = await ytSearchDump(query, sinceYmd);
  if (!candidates.length) {
    log.warn("video", `no youtube candidates for "${query}"`);
    return null;
  }
  log.info("video", `found ${candidates.length} candidates, scoring…`);

  const ranked = candidates
    .map((c) => ({ c, score: scoreCandidate(query, storyDate, c) }))
    .sort((a, b) => b.score - a.score);

  for (const { c, score } of ranked.slice(0, 5)) {
    if (score < 0.35) {
      log.warn("video", `top score too low (${score.toFixed(2)}), giving up`);
      break;
    }
    log.tool("video", `try ${c.id} (${c.channel}, score=${score.toFixed(2)}) "${c.title.slice(0, 60)}"`);
    const tmp = `${outPath}.raw.mp4`;
    const ok = await ytDlpDownload(c.webpage_url, tmp);
    if (!ok) continue;
    const st = await stat(tmp).catch(() => null);
    if (!st || st.size < 50_000) continue;
    await transcodeFor4x5(tmp, outPath, maxSeconds, 1080, 1350);
    log.ok("video", `youtube clip ready -> ${outPath}`);
    return outPath;
  }
  return null;
}

function scoreCandidate(headline: string, storyDate: Date, c: YtCandidate): number {
  const tokens = headline.toLowerCase().split(/\W+/).filter((t) => t.length >= 4);
  const titleLower = c.title.toLowerCase();
  const overlap = tokens.filter((t) => titleLower.includes(t)).length;
  const sim = tokens.length ? Math.min(1, overlap / tokens.length) : 0;

  const upY = parseInt(c.upload_date.slice(0, 4), 10);
  const upM = parseInt(c.upload_date.slice(4, 6), 10) - 1;
  const upD = parseInt(c.upload_date.slice(6, 8), 10);
  const upDate = new Date(Date.UTC(upY, upM, upD));
  const dayDelta = Math.abs(storyDate.getTime() - upDate.getTime()) / 86_400_000;
  const recency = Math.max(0, 1 - dayDelta / 7);

  const channelKey = c.channel.toLowerCase().replace(/\s/g, "");
  const official = OFFICIAL_CHANNELS.has(channelKey) || OFFICIAL_CHANNELS.has(c.channel.toLowerCase()) ? 1 : 0;
  const durOk = c.duration >= 5 && c.duration <= 600 ? 1 : 0;
  const popularity = Math.min(1, Math.log10(((c.view_count ?? 0) + 1)) / 6);

  return 0.45 * sim + 0.20 * recency + 0.20 * official + 0.10 * durOk + 0.05 * popularity;
}

function ytSearchDump(query: string, sinceYmd: string): Promise<YtCandidate[]> {
  return new Promise((resolve) => {
    const args = [
      `ytsearchdate20:${query}`,
      "--match-filter",
      `upload_date>=${sinceYmd} & duration>=5 & duration<=600 & !is_live`,
      "--dump-json",
      "--no-warnings",
      "--skip-download",
      "--no-playlist",
      "--socket-timeout", "15",
    ];
    const p = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const killT = setTimeout(() => {
      log.warn("video", `yt-dlp search timed out, killing`);
      p.kill("SIGKILL");
    }, 60_000);
    p.stdout.on("data", (c) => (stdout += c.toString()));
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", () => { clearTimeout(killT); resolve([]); });
    p.on("exit", () => {
      clearTimeout(killT);
      const lines = stdout.trim().split("\n").filter(Boolean);
      const out: YtCandidate[] = [];
      for (const l of lines) {
        try {
          const j = JSON.parse(l) as YtCandidate & Record<string, unknown>;
          out.push({
            id: j.id,
            title: j.title,
            channel: (j.channel ?? j.uploader ?? "") as string,
            channel_id: j.channel_id,
            upload_date: j.upload_date,
            duration: j.duration ?? 0,
            view_count: j.view_count,
            webpage_url: j.webpage_url ?? `https://www.youtube.com/watch?v=${j.id}`,
          });
        } catch {
          // ignore malformed
        }
      }
      if (!out.length && stderr) log.warn("video", `yt-dlp search stderr: ${stderr.slice(-200)}`);
      resolve(out);
    });
  });
}

function ytDlpDownload(url: string, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = [
      "-f", "best[ext=mp4][height<=1080]/best[height<=1080]/best",
      "--max-filesize", "120M",
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "20",
      "--retries", "1",
      "--extractor-args", "youtube:player_client=web,android",
      "--write-auto-subs",
      "--write-subs",
      "--sub-langs", "en.*,en",
      "--sub-format", "vtt",
      "--convert-subs", "vtt",
      "-o", outPath,
      url,
      "--quiet",
    ];
    const p = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => {
      log.warn("video", `yt-dlp ${url.slice(0, 50)} timed out, killing`);
      p.kill("SIGKILL");
    }, 90_000);
    p.on("error", () => { clearTimeout(t); resolve(false); });
    p.on("exit", (code) => { clearTimeout(t); resolve(code === 0); });
  });
}

function hasYtDlp(): boolean {
  try {
    execSync("which yt-dlp", { stdio: "ignore" });
    return true;
  } catch {
    return false;
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

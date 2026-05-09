import { log } from "../log.js";
import type { ExtractedAsset } from "./extractor.js";

const UA = "Mozilla/5.0 ai-carousel-factory";

export function isGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0]!, repo: parts[1]!.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

export async function fetchGitHubReadmeImage(repoUrl: string): Promise<ExtractedAsset | null> {
  const repo = isGitHubRepoUrl(repoUrl);
  if (!repo) return null;
  try {
    const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`;
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": UA, accept: "application/vnd.github.raw" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      log.warn("asset", `github readme HTTP ${res.status} for ${repo.owner}/${repo.repo}`);
      return null;
    }
    const md = await res.text();
    const candidates = extractImageUrls(md, repo);
    if (!candidates.length) {
      log.warn("asset", `no images in readme of ${repo.owner}/${repo.repo}`);
      return null;
    }
    for (const url of candidates) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) continue;
        const mimeType = r.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
        if (!mimeType.startsWith("image/")) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 4000) continue;
        log.ok("asset", `github readme image ${(buf.length / 1024).toFixed(0)}KB from ${url.slice(0, 80)}`);
        return { buffer: buf, mimeType, source: url };
      } catch {
        continue;
      }
    }
    return null;
  } catch (e) {
    log.warn("asset", `github readme fetch failed: ${(e as Error).message}`);
    return null;
  }
}

function extractImageUrls(md: string, repo: { owner: string; repo: string }): string[] {
  const urls: string[] = [];
  // markdown ![alt](url)
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    if (m[1]) urls.push(m[1]);
  }
  // html <img src="url">
  for (const m of md.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (m[1]) urls.push(m[1]);
  }
  return urls
    .map((u) => absolutizeRepoUrl(u, repo))
    .filter((u) => /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(u))
    .slice(0, 6);
}

function absolutizeRepoUrl(url: string, repo: { owner: string; repo: string }): string {
  if (/^https?:/i.test(url)) return url;
  // raw github relative paths
  const cleaned = url.replace(/^\.\//, "").replace(/^\//, "");
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${cleaned}`;
}

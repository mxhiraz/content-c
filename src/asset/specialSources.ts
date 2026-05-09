import { log } from "../log.js";
import type { ExtractedAsset } from "./extractor.js";

const UA = "Mozilla/5.0 ai-carousel-factory";

const fetchImageBytes = async (url: string, label: string): Promise<ExtractedAsset | null> => {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!r.ok) return null;
    const mimeType = r.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
    if (!mimeType.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 4_000) return null;
    log.ok("asset", `${label} ${(buf.length / 1024).toFixed(0)}KB from ${url.slice(0, 80)}`);
    return { buffer: buf, mimeType, source: url };
  } catch (e) {
    log.warn("asset", `${label} fetch failed: ${(e as Error).message}`);
    return null;
  }
};

// HuggingFace Papers: huggingface.co/papers/2501.12345
export function isHFPaperUrl(url: string): { id: string } | null {
  const m = url.match(/huggingface\.co\/papers\/([\w.\-]+)/i);
  return m ? { id: m[1]! } : null;
}

export async function fetchHFPaperImage(url: string): Promise<ExtractedAsset | null> {
  const ref = isHFPaperUrl(url);
  if (!ref) return null;
  try {
    const apiUrl = `https://huggingface.co/api/papers/${ref.id}`;
    const r = await fetch(apiUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { thumbnail?: string; paper?: { thumbnail?: string } };
    const thumb = j.thumbnail ?? j.paper?.thumbnail;
    if (!thumb) {
      log.warn("asset", `HF paper ${ref.id} has no thumbnail`);
      return null;
    }
    return await fetchImageBytes(thumb, `hf-paper:${ref.id}`);
  } catch (e) {
    log.warn("asset", `hf paper failed: ${(e as Error).message}`);
    return null;
  }
}

// arXiv → ar5iv first figure
export function isArxivUrl(url: string): { id: string } | null {
  const m = url.match(/arxiv\.org\/(?:abs|pdf|html)\/([\d.]+v?\d*)/i);
  return m ? { id: m[1]!.replace(/\.pdf$/, "") } : null;
}

export async function fetchArxivFigureImage(url: string): Promise<ExtractedAsset | null> {
  const ref = isArxivUrl(url);
  if (!ref) return null;
  try {
    const html = await (await fetch(`https://ar5iv.labs.arxiv.org/html/${ref.id}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    })).text();
    // Find first <figure> img
    const m = html.match(/<figure[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
    if (!m) {
      log.warn("asset", `ar5iv ${ref.id} no figure`);
      return null;
    }
    let imgUrl = m[1]!;
    if (imgUrl.startsWith("/")) imgUrl = `https://ar5iv.labs.arxiv.org${imgUrl}`;
    return await fetchImageBytes(imgUrl, `arxiv-fig:${ref.id}`);
  } catch (e) {
    log.warn("asset", `ar5iv failed: ${(e as Error).message}`);
    return null;
  }
}

// Detect "author headshot" image candidates by url/class hints
export function looksLikeAuthorHeadshot(url: string, htmlContext = ""): boolean {
  const lower = `${url} ${htmlContext}`.toLowerCase();
  return /\b(avatar|headshot|byline|author|writer|profile_pic|profile-pic|author-image|gravatar)\b/.test(lower);
}

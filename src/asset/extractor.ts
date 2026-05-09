import { log } from "../log.js";

export interface ExtractedAsset {
  buffer: Buffer;
  mimeType: string;
  source: string;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

export async function extractSubjectImage(sourceUrl: string): Promise<ExtractedAsset | null> {
  try {
    const html = await fetchText(sourceUrl);
    const candidate =
      pickMeta(html, "og:image") ??
      pickMeta(html, "twitter:image") ??
      pickFirstImg(html, sourceUrl);
    if (!candidate) {
      log.warn("asset", `no og:image / twitter:image for ${sourceUrl}`);
      return null;
    }
    const abs = absolutize(candidate, sourceUrl);
    const asset = await fetchImage(abs);
    log.ok("asset", `subject image extracted (${(asset.buffer.length / 1024).toFixed(0)}KB) from ${abs.slice(0, 80)}`);
    return { ...asset, source: abs };
  } catch (e) {
    log.warn("asset", `subject image extract failed: ${(e as Error).message}`);
    return null;
  }
}

export interface PageAssets {
  primaryImage: ExtractedAsset | null;
  galleryImages: ExtractedAsset[];
  videoUrls: string[];
}

export async function extractAllSourceAssets(sourceUrl: string, opts: { maxImages?: number } = {}): Promise<PageAssets> {
  const max = opts.maxImages ?? 6;
  try {
    const html = await fetchText(sourceUrl);
    const og = pickMeta(html, "og:image");
    const tw = pickMeta(html, "twitter:image");
    const ogVideo = pickMeta(html, "og:video") ?? pickMeta(html, "og:video:url") ?? pickMeta(html, "og:video:secure_url");
    const tStream = pickMeta(html, "twitter:player:stream");

    const inline = extractAllImageSrcs(html, sourceUrl);
    const orderedUrls = unique(
      [og, tw, ...inline].filter((u): u is string => !!u).map((u) => absolutize(u, sourceUrl))
    );

    const top = orderedUrls.slice(0, max + 4);
    const fetched = await Promise.all(top.map((u) => fetchImage(u).then((a) => ({ ...a, source: u })).catch(() => null)));
    const ok = fetched.filter((a): a is ExtractedAsset => !!a);

    // Filter out tiny/icon-sized images, prefer large
    const sized = await Promise.all(
      ok.map(async (a) => {
        try {
          const meta = await sharpMeta(a.buffer);
          return { asset: a, w: meta.width ?? 0, h: meta.height ?? 0 };
        } catch {
          return { asset: a, w: 0, h: 0 };
        }
      })
    );
    const isLogoLike = (asset: ExtractedAsset, w: number, h: number): boolean => {
      const url = asset.source.toLowerCase();
      if (/(^|[/_-])(logo|seal|favicon|wordmark|brand[_-]?mark|icon|sprite|gov_logo)/.test(url)) return true;
      // square + small often = logo/seal
      const ratio = w > 0 && h > 0 ? Math.max(w, h) / Math.min(w, h) : 99;
      const area = w * h;
      if (ratio < 1.15 && area < 600 * 600) return true;
      return false;
    };

    const big = sized.filter((s) => s.w >= 480 && s.h >= 320);
    const medium = sized.filter((s) => s.w >= 320 && s.h >= 200 && (s.w < 480 || s.h < 320));
    big.sort((a, b) => b.w * b.h - a.w * a.h);
    medium.sort((a, b) => b.w * b.h - a.w * a.h);
    const ranked = [...big, ...medium];

    // Demote logo-like images: only used as gallery, never as primary subject
    const photoLike = ranked.filter((s) => !isLogoLike(s.asset, s.w, s.h));
    const logoLike = ranked.filter((s) => isLogoLike(s.asset, s.w, s.h));

    const primary = photoLike[0]?.asset ?? null;
    const gallery = [...photoLike.slice(1), ...logoLike].slice(0, max).map((s) => s.asset);

    const videos = unique([ogVideo, tStream].filter((v): v is string => !!v).map((u) => absolutize(u, sourceUrl)));

    log.ok("asset", `source page: primary=${!!primary} gallery=${gallery.length} videos=${videos.length}`);
    return { primaryImage: primary, galleryImages: gallery, videoUrls: videos };
  } catch (e) {
    log.warn("asset", `source page extract failed: ${(e as Error).message}`);
    return { primaryImage: null, galleryImages: [], videoUrls: [] };
  }
}

function extractAllImageSrcs(html: string, _base: string): string[] {
  const out: string[] = [];
  const HEADSHOT_RE = /\b(avatar|headshot|byline|author|writer|profile[_-]pic|gravatar|user-photo)\b/i;

  // Match the full <img ...> tag so we can scan its full context for author hints
  const reImg = /<img[^>]+>/gi;
  for (const fullMatch of html.matchAll(reImg)) {
    const tag = fullMatch[0];
    if (HEADSHOT_RE.test(tag)) continue;
    const srcMatch = tag.match(/(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["']/i);
    const srcsetMatch = tag.match(/srcset=["']([^"']+)["']/i);
    if (srcMatch?.[1]) out.push(srcMatch[1]);
    if (srcsetMatch?.[1]) {
      const last = srcsetMatch[1].split(",").pop()?.trim().split(" ")[0];
      if (last) out.push(last);
    }
  }
  return out.filter((u) => /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u) && !HEADSHOT_RE.test(u));
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function sharpMeta(buf: Buffer): Promise<{ width?: number; height?: number }> {
  const sharp = (await import("sharp")).default;
  return sharp(buf).metadata();
}

export async function fetchImageUrl(url: string, label = "image"): Promise<ExtractedAsset | null> {
  try {
    const asset = await fetchImage(url);
    log.ok("asset", `${label} ${(asset.buffer.length / 1024).toFixed(0)}KB from ${url.slice(0, 80)}`);
    return { ...asset, source: url };
  } catch (e) {
    log.warn("asset", `${label} fetch failed ${url.slice(0, 80)}: ${(e as Error).message}`);
    return null;
  }
}

export async function searchGdeltImages(query: string, max = 4): Promise<ExtractedAsset[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ImageCollage&format=json&maxrecords=${max}&timespan=72h`;
  try {
    const data = await fetchJson<{ images?: Array<{ url: string }> }>(url);
    const urls = (data.images ?? []).slice(0, max).map((i) => i.url).filter(Boolean);
    if (!urls.length) {
      log.warn("asset", `gdelt: 0 images for "${query}"`);
      return [];
    }
    const assets = await Promise.all(urls.map((u) => fetchImage(u).then((a) => ({ ...a, source: u })).catch(() => null)));
    const ok = assets.filter((a): a is ExtractedAsset => !!a);
    log.ok("asset", `gdelt returned ${ok.length}/${urls.length} images for "${query}"`);
    return ok;
  } catch (e) {
    log.warn("asset", `gdelt failed: ${(e as Error).message}`);
    return [];
  }
}

export async function searchWikipediaImage(query: string): Promise<ExtractedAsset | null> {
  const cleaned = query.replace(/(portrait|photo|founder|ceo|cto|head shot|headshot)/gi, "").trim();
  if (!cleaned) return null;
  try {
    const summary = await fetchJson<{ originalimage?: { source: string }; thumbnail?: { source: string } }>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleaned)}?redirect=true`
    );
    const url = summary?.originalimage?.source ?? summary?.thumbnail?.source;
    if (!url) {
      log.warn("asset", `wiki: no image for "${cleaned}"`);
      return null;
    }
    const asset = await fetchImage(url);
    log.ok("asset", `wikipedia subject "${cleaned}" -> ${(asset.buffer.length / 1024).toFixed(0)}KB`);
    return { ...asset, source: url };
  } catch {
    try {
      const search = await fetchJson<{ query?: { search?: { title: string }[] } }>(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(cleaned)}&origin=*`
      );
      const title = search.query?.search?.[0]?.title;
      if (!title) return null;
      const summary = await fetchJson<{ originalimage?: { source: string }; thumbnail?: { source: string } }>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
      );
      const url = summary?.originalimage?.source ?? summary?.thumbnail?.source;
      if (!url) return null;
      const asset = await fetchImage(url);
      log.ok("asset", `wikipedia (search) "${title}" -> ${(asset.buffer.length / 1024).toFixed(0)}KB`);
      return { ...asset, source: url };
    } catch (e) {
      log.warn("asset", `wikipedia search failed for "${cleaned}": ${(e as Error).message}`);
      return null;
    }
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ai-carousel-factory/0.1 (research)", accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

export async function fetchProductScreenshot(domain: string): Promise<ExtractedAsset | null> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const homepage = `https://${cleanDomain}`;
  try {
    const html = await fetchText(homepage);
    const candidate =
      pickMeta(html, "og:image") ??
      pickMeta(html, "twitter:image") ??
      pickFirstImg(html, homepage);
    if (!candidate) {
      log.warn("asset", `no product image for ${cleanDomain}`);
      return null;
    }
    const abs = absolutize(candidate, homepage);
    const asset = await fetchImage(abs);
    log.ok("asset", `product screenshot for ${cleanDomain} (${(asset.buffer.length / 1024).toFixed(0)}KB)`);
    return { ...asset, source: abs };
  } catch (e) {
    log.warn("asset", `product screenshot extract failed for ${cleanDomain}: ${(e as Error).message}`);
    return null;
  }
}

export async function fetchLogo(domain: string): Promise<ExtractedAsset | null> {
  const url = `https://logo.clearbit.com/${encodeURIComponent(domain)}?size=512&format=png`;
  try {
    const asset = await fetchImage(url);
    log.ok("asset", `logo fetched for ${domain}`);
    return { ...asset, source: url };
  } catch {
    log.warn("asset", `clearbit logo missing for ${domain}, trying favicon`);
    try {
      const fav = await fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`);
      return { ...fav, source: `google-favicon:${domain}` };
    } catch (e) {
      log.warn("asset", `favicon fallback failed for ${domain}: ${(e as Error).message}`);
      return null;
    }
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchImage(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, accept: "image/*" },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
  if (!mimeType.startsWith("image/")) throw new Error(`not an image: ${mimeType}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 1024) throw new Error(`image too small: ${buffer.length}B`);
  return { buffer, mimeType };
}

function pickMeta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escape(prop)}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m?.[1]) return m[1];
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escape(prop)}["']`, "i");
  const m2 = html.match(re2);
  return m2?.[1] ?? null;
}

function pickFirstImg(html: string, _baseUrl: string): string | null {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1] ?? null;
}

function absolutize(maybeRel: string, base: string): string {
  try {
    return new URL(maybeRel, base).toString();
  } catch {
    return maybeRel;
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

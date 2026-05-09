import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { config } from "../config.js";
import { log } from "../log.js";
import type { SlideSpec } from "../types.js";
import { extractAllSourceAssets, fetchLogo, fetchProductScreenshot, fetchImageUrl, searchWikipediaImage, searchGdeltImages, type ExtractedAsset } from "../asset/extractor.js";
import { fetchGitHubReadmeImage, isGitHubRepoUrl } from "../asset/githubReadme.js";
import { fetchHFPaperImage, isHFPaperUrl, fetchArxivFigureImage, isArxivUrl } from "../asset/specialSources.js";
import { gptImage2 } from "./falClient.js";
import { geminiGenerateImage, type GeminiReferenceImage } from "./geminiClient.js";
import { buildBodyPrompt, buildHookPrompt } from "./prompts.js";
import { compositeBodySlide, compositeHookSlide, compositeHookBase, compositeHookTextOverlay, compositeBodyTextOverlay, extractAccentColor, setAccent, type HookStyle } from "./composite.js";
import { extractSourceVideo } from "../video/extractSourceVideo.js";
import { searchYouTubeVideo } from "../video/youtubeSearch.js";
import { fetchXHandleVideo } from "../video/xHandleVideo.js";
import { videoHookOverlay, videoBodyOverlay } from "../video/videoHookOverlay.js";
import { extractVideoFrames } from "../video/extractFrames.js";
import { loadVtt, pickWindowForText, logTranscriptSummary } from "../video/transcript.js";

const FAL_SLIDE_SIZE = { width: 1024, height: 1280 };
const concurrency = pLimit(int("RENDER_CONCURRENCY", 8));
function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = raw.split("#")[0]?.trim() ?? "";
  return v.length > 0 ? v : fallback;
}

const BODY_RENDERER = strEnv("BODY_RENDERER", "gemini") as "gemini" | "composite";
const HOOK_RENDERER = strEnv("HOOK_RENDERER", "composite") as "gemini" | "composite";
const HOOK_TYPOGRAPHY = strEnv("HOOK_TYPOGRAPHY", "canvas") as "canvas" | "gemini";
const HOOK_STYLE = strEnv("HOOK_STYLE", "overlay") as HookStyle;
const VIDEO_COVER = boolEnv("VIDEO_COVER", false);
const VIDEO_BODY = boolEnv("VIDEO_BODY", false);
const SOURCE_VIDEO = boolEnv("SOURCE_VIDEO", false);
const YOUTUBE_SEARCH = boolEnv("YOUTUBE_SEARCH", false); // off by default — random YT search = copyright risk

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = raw.split("#")[0]?.trim().toLowerCase() ?? "";
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface RenderedSlide {
  slideNumber: number;
  kind: "hook" | "body" | "cta";
  prompt: string;
  filePath: string;
}

export interface RenderedCarousel {
  carouselId: string;
  outputDir: string;
  slides: RenderedSlide[];
  spec: SlideSpec;
}

export async function renderCarousel(spec: SlideSpec): Promise<RenderedCarousel> {
  const outDir = path.resolve(config.pipeline.outputDir, spec.carousel_id);
  await mkdir(outDir, { recursive: true });

  log.step("asset", `extract subject + logos + related scenes (source-first)`);
  const relatedUrls = (spec.related_image_urls ?? []).slice(0, 4);
  const dedupedDomains = Array.from(
    new Set(spec.hook_slide.entity_domains.map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim()).filter(Boolean))
  ).slice(0, 2);
  // Special-source detectors (run only when URL pattern matches)
  const ghRepoFromSource = isGitHubRepoUrl(spec.source_url);
  const hfPaperRef = isHFPaperUrl(spec.source_url);
  const arxivRef = isArxivUrl(spec.source_url);
  const ghReadmePromise = ghRepoFromSource ? fetchGitHubReadmeImage(spec.source_url) : Promise.resolve(null);
  const hfPaperPromise = hfPaperRef ? fetchHFPaperImage(spec.source_url) : Promise.resolve(null);
  const arxivPromise = arxivRef ? fetchArxivFigureImage(spec.source_url) : Promise.resolve(null);

  const [pageAssets, wikiSubject, relatedAssets, gdeltAssets, githubAsset, hfPaperAsset, arxivAsset, ...logos] = await Promise.all([
    extractAllSourceAssets(spec.source_url, { maxImages: 6 }),
    searchWikipediaImage(spec.hook_slide.subject_photo_query),
    Promise.all(relatedUrls.map((u) => fetchImageUrl(u, "related"))),
    searchGdeltImages(spec.hook_slide.subject_photo_query || spec.hook_slide.headline, 4),
    ghReadmePromise,
    hfPaperPromise,
    arxivPromise,
    ...dedupedDomains.map((d) => fetchLogo(d)),
  ]);
  const sceneAssets: ExtractedAsset[] = [
    ...(githubAsset ? [githubAsset] : []),
    ...(hfPaperAsset ? [hfPaperAsset] : []),
    ...(arxivAsset ? [arxivAsset] : []),
    ...pageAssets.galleryImages,
    ...relatedAssets.filter((a): a is ExtractedAsset => !!a),
    ...gdeltAssets,
  ];
  // subject preference: prefer story-specific source-page primary over Wiki (Wiki repeats across carousels for same entity)
  const looksLikePerson = isLikelyPersonName(spec.hook_slide.subject_photo_query);
  const personFirst: (ExtractedAsset | null)[] = [githubAsset, hfPaperAsset, arxivAsset, pageAssets.primaryImage, wikiSubject, sceneAssets[0] ?? null];
  const productFirst: (ExtractedAsset | null)[] = [githubAsset, hfPaperAsset, arxivAsset, pageAssets.primaryImage, wikiSubject, sceneAssets[0] ?? null];
  let subject: ExtractedAsset | null = (looksLikePerson ? personFirst : productFirst).find((a): a is ExtractedAsset => !!a) ?? null;

  // Dedup: if subject hash matches a recent carousel, walk to next candidate; if all repeat, force Gemini fallback
  const recent = await loadRecentSubjects();
  const candidates = (looksLikePerson ? personFirst : productFirst).filter((a): a is ExtractedAsset => !!a);
  let chosenHash = subject ? hashBuffer(subject.buffer) : "";
  if (subject && recent.includes(chosenHash)) {
    const fresh = candidates.find((c) => !recent.includes(hashBuffer(c.buffer)));
    if (fresh) {
      subject = fresh;
      chosenHash = hashBuffer(fresh.buffer);
      log.info("asset", `swapped subject to non-recent candidate (avoid repeat)`);
    } else {
      log.info("asset", `all subject candidates seen recently, forcing Gemini hook gen`);
      subject = null; // forces gemini fallback path in render
    }
  }
  if (chosenHash) await saveRecentSubjects([...recent, chosenHash]);
  const sourceVideoUrls = pageAssets.videoUrls;
  const hookRefs: GeminiReferenceImage[] = [];
  if (subject) hookRefs.push(toRef(subject, "SUBJECT_PHOTO (use this exact face / scene)"));
  const goodLogos: { domain: string; asset: ExtractedAsset }[] = [];
  dedupedDomains.forEach((d, i) => {
    const a = logos[i];
    if (a) goodLogos.push({ domain: d, asset: a });
  });
  goodLogos.forEach((l) => {
    hookRefs.push(toRef(l.asset, `LOGO_${l.domain.toUpperCase()} (use this exact mark, do not redraw)`));
  });
  sceneAssets.slice(0, 2).forEach((a, i) => {
    if (a !== subject) hookRefs.push(toRef(a, `SCENE_REFERENCE_${i + 1} (use as inspiration for background scene context, blur appropriately)`));
  });
  const logoCount = goodLogos.length;
  log.ok("asset", `hook refs: ${hookRefs.length} (subject=${!!subject}, logos=${logoCount}/${dedupedDomains.length}, scenes=${sceneAssets.length})`);

  const accent = subject ? await extractAccentColor(subject.buffer) : config.brand.highlightColor;
  setAccent(accent);
  log.ok("asset", `accent color = ${accent}`);

  type Task = {
    number: number;
    kind: RenderedSlide["kind"];
    prompt: string;
    references?: GeminiReferenceImage[];
    composite?: { slideIndex: number; attachedImage?: Buffer };
    hookComposite?: { subjectImage: Buffer; logoImages: Buffer[]; sourceVideoPath?: string };
  };

  const tasks: Task[] = [];

  let resolvedSourceVideo: string | undefined;
  let videoFrames: Buffer[] = [];
  const wantSourceVideo = sourceVideoUrls.length > 0 || SOURCE_VIDEO || VIDEO_COVER || VIDEO_BODY;
  if (wantSourceVideo) {
    const sourcePath = path.join(outDir, "00_source.mp4");
    // Try in order: source URL embedded → Claude-found related video URLs → Pexels topic search
    const candidates: { label: string; tryFn: () => Promise<string | null> }[] = [
      { label: "source URL", tryFn: () => extractSourceVideo(spec.source_url, { outPath: sourcePath, maxSeconds: 12 }) },
    ];
    for (const u of spec.related_video_urls) {
      candidates.push({ label: `related ${new URL(u).hostname}`, tryFn: () => extractSourceVideo(u, { outPath: sourcePath, maxSeconds: 12 }) });
    }
    // Official entity X handles (Anthropic, OpenAI, etc.) — most likely to host the actual announcement video
    for (const handle of spec.entity_x_handles) {
      candidates.push({
        label: `x @${handle}`,
        tryFn: () => fetchXHandleVideo(handle, spec.hook_slide.headline, sourcePath),
      });
    }
    if (YOUTUBE_SEARCH) {
      const ytQuery = `${spec.hook_slide.subject_photo_query} ${spec.hook_slide.headline}`.trim();
      candidates.push({
        label: `youtube search "${ytQuery.slice(0, 50)}"`,
        tryFn: () => searchYouTubeVideo(ytQuery, sourcePath, 12, new Date()),
      });
    }

    for (const cand of candidates) {
      try {
        log.tool("video", `trying ${cand.label}`);
        const got = await cand.tryFn();
        if (got) {
          resolvedSourceVideo = got;
          break;
        }
      } catch (e) {
        log.warn("video", `${cand.label} failed: ${(e as Error).message}`);
      }
    }

    if (resolvedSourceVideo) {
      videoFrames = await extractVideoFrames(resolvedSourceVideo, { count: 5 }).catch(() => []);
      log.ok("video", `frames available for slides: ${videoFrames.length}`);
      if (videoFrames[0]) {
        subject = { buffer: videoFrames[0], mimeType: "image/png", source: "source_video_frame_0" };
        log.ok("video", `hook subject overridden to source video frame 0`);
      }
    } else {
      log.warn("video", `no video sourced; skipping video output (install yt-dlp + set PEXELS_KEY for fallback)`);
    }
  }

  const useHookComposite = HOOK_RENDERER === "composite" && !!subject;
  tasks.push({
    number: 1,
    kind: "hook",
    prompt: buildHookPrompt(spec.hook_slide, config.brand.handle, accent),
    references: hookRefs,
    hookComposite: useHookComposite
      ? {
          subjectImage: subject!.buffer,
          logoImages: logos.filter((l): l is ExtractedAsset => !!l).map((l) => l.buffer),
          sourceVideoPath: resolvedSourceVideo,
        }
      : undefined,
  });

  const bodyTasks: Task[] = await Promise.all(
    spec.body_slides.map(async (body, idx) => {
      const refs: GeminiReferenceImage[] = [];
      let attached: Buffer | undefined;

      // Prefer source video frame for THIS body slide (varies frame per slide for visual variety)
      const frameForSlide = videoFrames.length > 0 ? videoFrames[(idx + 1) % videoFrames.length] : undefined;

      if (body.layout_variant === "text_explainer" && body.product_screenshot_query) {
        const shot = await fetchProductScreenshot(body.product_screenshot_query);
        if (shot) {
          refs.push(toRef(shot, "PRODUCT_SCREENSHOT (place verbatim in centered mockup)"));
          attached = shot.buffer;
        }
      }
      if (!attached && frameForSlide) {
        attached = frameForSlide;
        refs.push({ buffer: frameForSlide, mimeType: "image/png", label: "SOURCE_VIDEO_FRAME (place full-bleed at top, this is the real news footage)" });
      } else if (!attached && sceneAssets.length > 0) {
        const sceneAsset = sceneAssets[idx % sceneAssets.length]!;
        attached = sceneAsset.buffer;
        refs.push(toRef(sceneAsset, "SOURCE_PAGE_IMAGE (place full-bleed at top, real photo from article)"));
      } else if (!attached && subject) {
        attached = subject.buffer;
        refs.push(toRef(subject, "SUBJECT_PHOTO (real photo, fallback)"));
      }
      return {
        number: body.slide_number,
        kind: "body" as const,
        prompt: buildBodyPrompt(body, config.brand.handle, accent),
        references: refs.length ? refs : undefined,
        composite: { slideIndex: idx, attachedImage: attached },
      };
    })
  );
  tasks.push(...bodyTasks);
  const totalSlides = tasks.length;

  log.step("render", `provider=${config.pipeline.imageProvider} body=${BODY_RENDERER} ${tasks.length} slides → ${outDir}`);
  const slides = await Promise.all(
    tasks.map((t) => concurrency(() => renderOne(t, outDir, spec, totalSlides, accent)))
  );
  log.ok("render", `all ${slides.length} slides rendered`);

  await writeFile(path.join(outDir, "spec.json"), JSON.stringify(spec, null, 2));
  await writeFile(
    path.join(outDir, "caption.txt"),
    `${spec.instagram_caption}\n\n${spec.hashtags.join(" ")}\n\nSource: ${spec.source_url}\n`
  );

  // Body slide videos: only text_explainer variant gets video bg.
  // stat_card / quote_pull / list_card = image-only (text on black), skip video.
  if (VIDEO_BODY && resolvedSourceVideo) {
    const videoVariants = spec.body_slides.filter((b) => b.layout_variant === "text_explainer");
    if (!videoVariants.length) {
      log.info("render", `no text_explainer body slides — skipping body videos (image-only carousel)`);
    } else {
      log.step("render", `body videos: ${videoVariants.length}/${spec.body_slides.length} slides (text_explainer only)`);
      const dur = await ffprobeDuration(resolvedSourceVideo);
      // Try VTT transcript next to source video (yt-dlp writes <name>.en.vtt etc.)
      const vttCandidates = [
        resolvedSourceVideo.replace(/\.mp4$/, ".en.vtt"),
        resolvedSourceVideo.replace(/\.mp4$/, ".en-US.vtt"),
        resolvedSourceVideo.replace(/\.mp4$/, ".en-GB.vtt"),
        `${resolvedSourceVideo}.raw.en.vtt`,
      ];
      let cues: Awaited<ReturnType<typeof loadVtt>> = [];
      for (const c of vttCandidates) {
        const got = await loadVtt(c);
        if (got.length) { cues = got; break; }
      }
      logTranscriptSummary(cues);

      // Unique non-overlapping timeline segments. Hook = slot 0. Body slides = slots 1..N.
      const totalVideoSlots = 1 + videoVariants.length;
      const idealSegLen = dur / totalVideoSlots;
      const segLen = Math.max(3, Math.min(8, idealSegLen));
      const startMax = Math.max(0, dur - segLen);
      const usedRanges: Array<{ start: number; end: number }> = [];
      await Promise.all(
        videoVariants.map(async (body, vIdx) => {
          // 1) Try transcript-matched window for this body's content
          let startSec: number;
          let chosenBy = "evenly-spaced";
          const queryText = `${body.headline} ${body.body_text}`;
          const matched = cues.length ? pickWindowForText(cues, queryText, segLen) : null;
          if (matched && !overlapsAny(matched.start, matched.start + segLen, usedRanges, segLen * 0.6)) {
            startSec = Math.min(startMax, Math.max(0, matched.start));
            chosenBy = "transcript-match";
          } else {
            const slotIdx = vIdx + 1;
            startSec = Math.min(startMax, slotIdx * idealSegLen);
          }
          usedRanges.push({ start: startSec, end: startSec + segLen });
          const overlay = compositeBodyTextOverlay(body, totalSlides);
          const mp4Path = path.join(outDir, `${String(body.slide_number).padStart(2, "0")}_body.mp4`);
          log.tool("video", `body ${body.slide_number} window: ${startSec.toFixed(1)}s..${(startSec + segLen).toFixed(1)}s of ${dur.toFixed(1)}s [${chosenBy}]`);
          try {
            await videoBodyOverlay({
              sourceVideoPath: resolvedSourceVideo!,
              overlayPng: overlay,
              outPath: mp4Path,
              durationSec: segLen,
              startSec,
              cropMode: "top-half",
            });
          } catch (e) {
            log.warn("render", `body video ${body.slide_number} failed: ${(e as Error).message}`);
          }
        })
      );
    }
  }

  return { carouselId: spec.carousel_id, outputDir: outDir, slides, spec };
}

function overlapsAny(start: number, end: number, ranges: Array<{ start: number; end: number }>, minGap: number): boolean {
  for (const r of ranges) {
    const overlap = Math.min(end, r.end) - Math.max(start, r.start);
    if (overlap > minGap) return true;
  }
  return false;
}

async function ffprobeDuration(videoPath: string): Promise<number> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.on("error", () => resolve(10));
    p.on("exit", () => {
      const v = parseFloat(out.trim());
      resolve(Number.isFinite(v) && v > 0 ? v : 10);
    });
  });
}

async function renderOne(
  task: { number: number; kind: RenderedSlide["kind"]; prompt: string; references?: GeminiReferenceImage[]; composite?: { slideIndex: number; attachedImage?: Buffer }; hookComposite?: { subjectImage: Buffer; logoImages: Buffer[]; sourceVideoPath?: string } },
  outDir: string,
  spec: SlideSpec,
  totalSlides: number,
  accent: string
): Promise<RenderedSlide> {
  const tag = `slide ${String(task.number).padStart(2, "0")} (${task.kind})`;
  const t0 = Date.now();

  const filename = `${String(task.number).padStart(2, "0")}_${task.kind}.png`;
  const filePath = path.join(outDir, filename);

  if (task.kind === "hook" && task.hookComposite) {
    if (HOOK_TYPOGRAPHY === "gemini") {
      log.tool("render", `${tag} → composite base + Gemini typography polish`);
      const base = await compositeHookBase(
        {
          hook: spec.hook_slide,
          subjectImage: task.hookComposite.subjectImage,
          logoImages: task.hookComposite.logoImages,
          brandHandle: config.brand.handle,
        },
        HOOK_STYLE
      );
      const polishPrompt = buildPolishPrompt(spec, HOOK_STYLE, accent);
      const out = await geminiGenerateImage({
        prompt: polishPrompt,
        aspectRatio: "4:5",
        resolution: "1K",
        references: [{ buffer: base.buffer, mimeType: "image/png", label: "BASE_IMAGE (preserve photo + logos verbatim, only ADD typography)" }],
      });
      await writeFile(filePath, out.buffer);
    } else {
      log.tool("render", `${tag} → composite ${HOOK_STYLE} (real photo, no AI)`);
      const buf = await compositeHookSlide(
        {
          hook: spec.hook_slide,
          subjectImage: task.hookComposite.subjectImage,
          logoImages: task.hookComposite.logoImages,
          brandHandle: config.brand.handle,
        },
        HOOK_STYLE
      );
      await writeFile(filePath, buf);
    }
    log.ok("render", `${tag} ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s → ${filename}`);

    if (VIDEO_COVER && task.hookComposite.sourceVideoPath) {
      const mp4Path = filePath.replace(/\.png$/, ".mp4");
      try {
        const overlay = compositeHookTextOverlay(spec.hook_slide);
        await videoHookOverlay({ sourceVideoPath: task.hookComposite.sourceVideoPath, overlayPng: overlay, outPath: mp4Path, durationSec: 8 });
      } catch (e) {
        log.warn("render", `video cover failed: ${(e as Error).message}`);
      }
    } else if (VIDEO_COVER) {
      log.warn("render", `VIDEO_COVER set but no source video found; png-only cover (skip Ken Burns zoom)`);
    }
    return { slideNumber: task.number, kind: task.kind, prompt: task.prompt, filePath };
  }

  const useComposite = task.kind === "body" && BODY_RENDERER === "composite" && task.composite;
  if (useComposite) {
    log.tool("render", `${tag} → composite (canvas, no AI)`);
    const body = spec.body_slides[task.composite!.slideIndex];
    if (!body) throw new Error(`no body slide at index ${task.composite!.slideIndex}`);
    const buf = await compositeBodySlide({
      slide: body,
      total: totalSlides,
      attachedImage: task.composite!.attachedImage,
      brandHandle: config.brand.handle,
    });
    await writeFile(filePath, buf);
    log.ok("render", `${tag} ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s → ${filename}`);
    return { slideNumber: task.number, kind: task.kind, prompt: task.prompt, filePath };
  }

  const refTag = task.references?.length ? ` +${task.references.length}refs` : "";
  log.tool("render", `${tag} → ${config.pipeline.imageProvider}${refTag} ...`);

  if (config.pipeline.imageProvider === "gemini") {
    if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY missing: set IMAGE_PROVIDER=fal or add the key");
    const out = await geminiGenerateImage({
      prompt: task.prompt,
      aspectRatio: "4:5",
      resolution: "1K",
      references: task.references,
    });
    await writeFile(filePath, out.buffer);
  } else {
    if (!config.falKey) throw new Error("FAL_KEY missing: set IMAGE_PROVIDER=gemini or add the key");
    const result = await gptImage2({
      prompt: task.prompt,
      image_size: FAL_SLIDE_SIZE,
      quality: "high",
      num_images: 1,
      output_format: "png",
    });
    const url = result.images[0]?.url;
    if (!url) throw new Error(`fal returned no image for slide ${task.number}`);
    await downloadTo(url, filePath);
  }

  log.ok("render", `${tag} ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s → ${filename}`);
  return { slideNumber: task.number, kind: task.kind, prompt: task.prompt, filePath };
}

function toRef(asset: ExtractedAsset, label: string): GeminiReferenceImage {
  return { buffer: asset.buffer, mimeType: asset.mimeType, label };
}

// Track recent subject-image hashes so we don't reuse the same photo across consecutive carousels
import { createHash } from "node:crypto";
import { readFile as _readFile, writeFile as _writeFile, mkdir as _mkdir } from "node:fs/promises";
const RECENT_SUBJECTS_FILE = path.join(config.pipeline.outputDir, ".recent-subjects.json");
const RECENT_LIMIT = 6;

async function loadRecentSubjects(): Promise<string[]> {
  try {
    const raw = await _readFile(RECENT_SUBJECTS_FILE, "utf8");
    return (JSON.parse(raw) as string[]) ?? [];
  } catch { return []; }
}
async function saveRecentSubjects(hashes: string[]): Promise<void> {
  await _mkdir(path.dirname(RECENT_SUBJECTS_FILE), { recursive: true });
  await _writeFile(RECENT_SUBJECTS_FILE, JSON.stringify(hashes.slice(-RECENT_LIMIT)));
}
function hashBuffer(b: Buffer): string {
  return createHash("sha1").update(b.subarray(0, Math.min(b.length, 200_000))).digest("hex").slice(0, 16);
}

function isLikelyPersonName(query: string): boolean {
  if (!query) return false;
  const cleaned = query.trim().replace(/\s+(portrait|photo|founder|ceo|cto|head\s*shot|headshot)$/i, "");
  // 2-4 capitalized words, no commas/digits, total <= 50 chars
  if (cleaned.length > 50) return false;
  if (/[,0-9]/.test(cleaned)) return false;
  const words = cleaned.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[A-Z][\w'.-]{1,}/.test(w));
}

function buildPolishPrompt(spec: SlideSpec, style: HookStyle, accent: string): string {
  const headline = spec.hook_slide.headline.toUpperCase();
  const sub = spec.hook_slide.sub_tagline.toUpperCase();
  const highlights = spec.hook_slide.highlight_phrases.map((p) => `"${p.toUpperCase()}"`).join(" + ");
  const purple = accent;
  const placement =
    style === "panel"
      ? "the SOLID BLACK PANEL at the BOTTOM of the canvas (lower 38%)."
      : style === "magazine"
      ? "the SOLID BLACK PANEL at the BOTTOM of the canvas (lower 22%)."
      : "the LOWER HALF of the canvas, directly on the photo (use natural darkness, no extra panel).";
  return `BASE_IMAGE = the provided reference. Treat it as the GROUND TRUTH for the photo, the brand logos, and the overall layout. Your job is to add the typography AND clean up any visual artifacts in the base, NOT to redesign it.

PRESERVE
- The subject's face / pose / clothing / lighting from the BASE_IMAGE: keep them PIXEL-IDENTICAL.
- The brand logo bitmaps in their existing positions, sizes, and colors. Do not redraw, recolor, or replace any logo.

CLEAN UP (only these specific artifacts in the base, if present)
- Any harsh seam where the photo meets the bottom black panel: smooth it with a natural gradient bridge so the transition feels intentional.
- Any visible step/stripe where the gradient ends: feather it.
- Any subtle banding in the dark areas: smooth.
Do NOT alter the photo content itself, only feather the seam.

ADD a headline on ${placement}
- Render this exact headline VERBATIM, ALL CAPS, in heavy bold condensed sans-serif (Druk Wide / Anton style), tight tracking, broken across 2-4 lines, centered horizontally, white:
  "${headline}"
- Within that headline, render the words ${highlights} in solid ${purple} (every other word stays white). Render this hex EXACTLY as specified, do NOT default to purple/magenta. The highlight color is opaque, not faded. Do not paraphrase or skip any word.

ADD a sub-tagline directly below the headline:
- Centered, smaller (~16% of headline size), bold ALL-CAPS in ${purple}:
  "${sub}"

ADD a swipe indicator at the very bottom edge:
- Centered, small white monospace, weight 700, ~20pt:
  "SWIPE FOR MORE  →"

HARD RULES
- The ONLY text in the entire image is the headline + sub-tagline + the "SWIPE FOR MORE →" indicator above. Nothing else.
- Do NOT add any other text: no @username, no brand handle, no ticker, no metadata, no dates, no times, no fake EXIF, no Instagram UI.
- Do NOT spell out any company names as text outside the headline.
- The photo and logos are PRESERVED pixel-perfect; only the typography is new.
- NO em dash, NO en dash, only periods/commas/colons/hyphens.
- Crisp print kerning, no spelling mistakes, no extra letters.`;
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

import path from "node:path";
import { readdir } from "node:fs/promises";
import { log } from "../log.js";
import { zipCarouselDir } from "./zip.js";
import { sendZipToWhatsApp } from "./whatsapp.js";
import { sendCarouselEmail } from "./email.js";
import { loadDeliveryConfig } from "./config.js";

/** List EVERY file in the carousel output dir — slides (.png/.mp4), caption.txt,
 *  spec.json, DM reply file, source video, anything else. Sorted by filename so slides
 *  arrive in swipe order (01_hook → 02_body → ...) and metadata files follow.
 *  Skips dotfiles + nested dirs. */
async function listAllCarouselFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

export interface DispatchInput {
  carouselDir: string;
  hookHeadline: string;
  caption: string;
  feed?: string;
  sourceUrl?: string;
}

export async function dispatchCarousel(input: DispatchInput): Promise<{ zipPath: string; sent: { whatsapp: boolean; email: boolean } }> {
  const cfg = await loadDeliveryConfig();
  const zipPath = await zipCarouselDir(input.carouselDir);
  const sent = { whatsapp: false, email: false };

  const subject = input.hookHeadline.length > 80 ? input.hookHeadline.slice(0, 77) + "..." : input.hookHeadline;
  const body =
    `Carousel: ${input.hookHeadline}\n` +
    (input.feed ? `Feed: ${input.feed}\n` : "") +
    (input.sourceUrl ? `Source: ${input.sourceUrl}\n` : "") +
    `\n${input.caption}\n\nZIP attached. Output dir: ${path.basename(input.carouselDir)}`;

  if (cfg.enableWhatsApp && (cfg.whatsappGroupId || cfg.whatsappGroupName)) {
    try {
      await sendZipToWhatsApp(zipPath, {
        chatId: cfg.whatsappGroupId,
        chatName: cfg.whatsappGroupName,
        caption: subject,
      });
      sent.whatsapp = true;
    } catch (e) {
      log.err("dispatch", `whatsapp send failed: ${(e as Error).message}`);
    }
  }
  if (cfg.enableEmail && cfg.emailRecipients?.length) {
    // Email: send individual slide files as attachments (NOT the zip).
    // Client direction May 2026 — recipients prefer images inline, no zip to unpack.
    // Toggle back to zip with EMAIL_SEND_ZIP=true.
    const sendAsZip = (process.env.EMAIL_SEND_ZIP ?? "false").toLowerCase() === "true";
    // Send ALL carousel files — slides + spec.json + caption.txt + DM reply (when feed=prompts)
    // + source video. Same contents as zip, just unzipped so recipient can open inline.
    const allFiles = await listAllCarouselFiles(input.carouselDir);
    const attachmentPaths = sendAsZip || allFiles.length === 0 ? [zipPath] : allFiles;
    const emailBody =
      `Carousel: ${input.hookHeadline}\n` +
      (input.feed ? `Feed: ${input.feed}\n` : "") +
      (input.sourceUrl ? `Source: ${input.sourceUrl}\n` : "") +
      `\n${input.caption}\n\n` +
      (sendAsZip
        ? `ZIP attached. Output dir: ${path.basename(input.carouselDir)}`
        : `${allFiles.length} files attached (slides + caption.txt + spec.json + DM reply if any). Output dir: ${path.basename(input.carouselDir)}`);
    for (const to of cfg.emailRecipients) {
      try {
        await sendCarouselEmail({ to, subject, body: emailBody, attachmentPaths });
        sent.email = true;
      } catch (e) {
        log.err("dispatch", `email to ${to} failed: ${(e as Error).message}`);
      }
    }
  }

  log.ok("dispatch", `dispatched: wa=${sent.whatsapp} email=${sent.email}`);
  return { zipPath, sent };
}

import path from "node:path";
import { log } from "../log.js";
import { zipCarouselDir } from "./zip.js";
import { sendZipToWhatsApp } from "./whatsapp.js";
import { sendCarouselEmail } from "./email.js";
import { loadDeliveryConfig } from "./config.js";

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
    for (const to of cfg.emailRecipients) {
      try {
        await sendCarouselEmail({ to, subject, body, attachmentPath: zipPath });
        sent.email = true;
      } catch (e) {
        log.err("dispatch", `email to ${to} failed: ${(e as Error).message}`);
      }
    }
  }

  log.ok("dispatch", `dispatched: wa=${sent.whatsapp} email=${sent.email}`);
  return { zipPath, sent };
}

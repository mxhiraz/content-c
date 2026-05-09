import path from "node:path";
import nodemailer from "nodemailer";
import { log } from "../log.js";

let cached: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (cached) return cached;
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error("SMTP_HOST/USER/PASS missing in env");
  cached = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cached;
}

export interface EmailSendOpts {
  to: string;
  subject: string;
  body: string;
  attachmentPath?: string;
}

export async function sendCarouselEmail(opts: EmailSendOpts): Promise<void> {
  const transport = getTransport();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;
  await transport.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    attachments: opts.attachmentPath
      ? [{ filename: path.basename(opts.attachmentPath), path: opts.attachmentPath }]
      : undefined,
  });
  log.ok("email", `sent "${opts.subject}" → ${opts.to}`);
}

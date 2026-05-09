import path from "node:path";
import { readFile } from "node:fs/promises";
import waPkg from "whatsapp-web.js";
import { log } from "../log.js";

const { MessageMedia } = waPkg;

interface SendOpts {
  caption?: string;
  chatId?: string;
  chatName?: string;
}

/**
 * Send a ZIP via an EXISTING WA client instance.
 * The config server owns the only WA client; worker calls config server's
 * /internal/wa-send HTTP endpoint, which in turn calls this with state.client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendZipViaClient(client: any, zipPath: string, opts: SendOpts): Promise<void> {
  let chatId = opts.chatId;
  if (!chatId && opts.chatName) {
    const chats = await client.getChats();
    const found = chats.find((c: { name?: string; id?: { _serialized?: string } }) => c.name === opts.chatName);
    chatId = found?.id?._serialized;
    if (!chatId) throw new Error(`whatsapp: chat "${opts.chatName}" not found`);
  }
  if (!chatId) throw new Error("whatsapp: chatId or chatName required");
  const buf = await readFile(zipPath);
  const media = new MessageMedia("application/zip", buf.toString("base64"), path.basename(zipPath));
  await client.sendMessage(chatId, media, { caption: opts.caption });
  log.ok("wa", `sent ${path.basename(zipPath)} to ${chatId}`);
}

/**
 * From the worker process: HTTP-bridge to the config server's /internal/wa-send.
 * Worker MUST NOT spawn its own WA client (chromium profile lock).
 */
const CONFIG_BRIDGE_URL = process.env.CONFIG_BRIDGE_URL ?? "http://127.0.0.1:8080";

export async function sendZipToWhatsApp(zipPath: string, opts: SendOpts): Promise<void> {
  const res = await fetch(`${CONFIG_BRIDGE_URL}/internal/wa-send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ zipPath, caption: opts.caption, chatId: opts.chatId, chatName: opts.chatName }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`wa-bridge HTTP ${res.status}: ${errText}`);
  }
  log.ok("wa", `sent via config bridge: ${path.basename(zipPath)}`);
}

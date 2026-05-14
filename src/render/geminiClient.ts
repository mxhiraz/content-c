import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { loadDeliveryConfig } from "../delivery/config.js";
import { log } from "../log.js";

// Cached by key — re-init when UI changes the key. Model name is read at request time.
let _client: { key: string; client: GoogleGenAI } | undefined;
let _runtimeCache: { ts: number; key: string; model: string } | undefined;

async function getRuntime(): Promise<{ key: string; model: string }> {
  if (_runtimeCache && Date.now() - _runtimeCache.ts < 5_000) {
    return { key: _runtimeCache.key, model: _runtimeCache.model };
  }
  const cfg = await loadDeliveryConfig().catch(() => null);
  const key = cfg?.geminiApiKey || config.geminiApiKey;
  const model = cfg?.geminiImageModel || config.models.imageModel;
  _runtimeCache = { ts: Date.now(), key, model };
  return { key, model };
}

export function invalidateGeminiRuntimeCache(): void {
  _runtimeCache = undefined;
}

function getClient(key: string): GoogleGenAI {
  if (!key) throw new Error("GEMINI_API_KEY required — set via config UI or env");
  if (_client?.key === key) return _client.client;
  _client = { key, client: new GoogleGenAI({ apiKey: key }) };
  return _client.client;
}

export interface GeminiReferenceImage {
  buffer: Buffer;
  mimeType: string;
  label: string;
}

export interface GeminiImageInput {
  prompt: string;
  aspectRatio?: "1:1" | "4:5" | "9:16" | "16:9" | "3:4" | "4:3";
  resolution?: "1K" | "2K" | "4K";
  references?: GeminiReferenceImage[];
}

export interface GeminiImageOutput {
  buffer: Buffer;
  mimeType: string;
}

export async function geminiGenerateImage(input: GeminiImageInput): Promise<GeminiImageOutput> {
  const rt = await getRuntime();
  const ai = getClient(rt.key);
  const t0 = Date.now();
  const refTag = input.references?.length ? ` +${input.references.length}refs` : "";
  log.tool("gemini", `generate model=${rt.model} ${input.aspectRatio ?? "default"} ${input.resolution ?? "1K"}${refTag} ...`);

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (input.references?.length) {
    parts.push({ text: "REFERENCE IMAGES (use these as visual ground truth):" });
    for (const ref of input.references) {
      parts.push({ text: `[${ref.label}]` });
      parts.push({
        inlineData: {
          data: ref.buffer.toString("base64"),
          mimeType: ref.mimeType,
        },
      });
    }
    parts.push({ text: "\nGENERATION INSTRUCTIONS:" });
  }
  parts.push({ text: input.prompt });

  const res = await ai.models.generateContent({
    model: rt.model,
    contents: parts,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: input.aspectRatio ?? "4:5",
        // Locked to 1K per client direction May 2026 — cost cap. Ignore caller overrides.
        imageSize: "1K",
      } as Record<string, unknown>,
    },
  });

  const candidate = res.candidates?.[0];
  const outParts = candidate?.content?.parts ?? [];
  for (const part of outParts) {
    const inline = part.inlineData;
    if (inline?.data) {
      const buf = Buffer.from(inline.data, "base64");
      log.ok("gemini", `image returned ${(buf.length / 1024).toFixed(0)}KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { buffer: buf, mimeType: inline.mimeType ?? "image/png" };
    }
  }

  const reason = candidate?.finishReason ?? "no_inline_data";
  const text = outParts.map((p) => p.text).filter(Boolean).join(" ");
  throw new Error(`Gemini returned no image (finishReason=${reason}). text=${text.slice(0, 300)}`);
}

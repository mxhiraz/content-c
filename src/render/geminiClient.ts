import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { log } from "../log.js";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
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
  const ai = getClient();
  const t0 = Date.now();
  const refTag = input.references?.length ? ` +${input.references.length}refs` : "";
  log.tool("gemini", `generate ${input.aspectRatio ?? "default"} ${input.resolution ?? "1K"}${refTag} ...`);

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
    model: config.models.imageModel,
    contents: parts,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: input.aspectRatio ?? "4:5",
        imageSize: input.resolution ?? "1K",
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

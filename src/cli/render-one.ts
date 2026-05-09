import { generateSlideSpec } from "../content/generate.js";
import { renderCarousel } from "../render/render.js";
import type { Article } from "../types.js";
import { createHash } from "node:crypto";

async function main(): Promise<void> {
  const url = process.argv[2];
  const title = process.argv[3];
  if (!url || !title) {
    console.error("Usage: tsx src/cli/render-one.ts <url> <title> [body-text]");
    process.exit(2);
  }
  const body = process.argv[4] ?? "";
  const article: Article = {
    id: createHash("sha1").update(url).digest("hex").slice(0, 16),
    source: "manual",
    url,
    title,
    body,
    publishedAt: new Date(),
    topicScore: 1,
  };
  const spec = await generateSlideSpec(article);
  const out = await renderCarousel(spec);
  console.log(`done → ${out.outputDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import archiver from "archiver";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { stat } from "node:fs/promises";
import { log } from "../log.js";

export async function zipCarouselDir(carouselDir: string, outZipPath?: string): Promise<string> {
  const dest = outZipPath ?? `${carouselDir}.zip`;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(dest);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", () => resolve());
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);
    archive.directory(carouselDir, path.basename(carouselDir));
    archive.finalize();
  });
  const sz = (await stat(dest)).size;
  log.ok("zip", `${dest} (${(sz / 1024).toFixed(0)}KB)`);
  return dest;
}

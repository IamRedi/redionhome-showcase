import sharp from "sharp";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
export type MediaManifest = {
  id: string;
  sha256: string;
  width: number;
  height: number;
  levels: { width: number; cols: number; rows: number }[];
};
export async function importPanorama(
  source: string,
  root: string,
  id: string,
  options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<MediaManifest> {
  const check = () => { if (options.signal?.aborted) throw Error('IMPORT_CANCELLED'); };
  check();
  if (!/^[\w-]{1,80}$/.test(id)) throw Error("Invalid media id");
  const bytes = readFileSync(source),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const final = path.join(root, "media", id);
  if (existsSync(final))
    throw Error("Media id exists. Use a new id to preserve originals.");
  const meta = await sharp(bytes, { limitInputPixels: 150_000_000 }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1)
    throw Error('PANORAMA_FORMAT');
  if (meta.orientation && meta.orientation !== 1) throw Error('PANORAMA_ORIENTATION');
  if (
    !meta.width ||
    !meta.height ||
    Math.abs(meta.width / meta.height - 2) > 0.02
  )
    throw Error("Panorama must be 2:1 equirectangular");
  if (meta.width < 2048) throw Error("Minimum panorama width is 2048");
  // Stage in the same filesystem. Failed processing never leaves a bindable partial import.
  const dir = path.join(root, "media", `.import-${randomUUID()}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    copyFileSync(source, path.join(dir, "original"));
    chmodSync(path.join(dir, "original"), 0o400);
    await sharp(bytes)
      .resize(1024, 512)
      .jpeg({ quality: 80 })
      .toFile(path.join(dir, "preview.jpg"));
    check();
    options.onProgress?.(10);
    const levels = [];
    let done = 0;
    const widths = [2048, 4096].filter(w => w <= meta.width!);
    const total = widths.reduce((n, w) => n + (w / 512) * (w / 1024), 0);
    for (const [index, width] of widths.entries()) {
      check();
      const cols = width / 512,
        rows = cols / 2;
      const image = await sharp(bytes)
        .resize(width, width / 2)
        .jpeg({quality: 94})
        .toBuffer();
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          check();
          await sharp(image)
            .extract({
              left: col * 512,
              top: row * 512,
              width: 512,
              height: 512,
            })
            .jpeg({ quality: 88 })
            .toFile(path.join(dir, `${index}-${col}-${row}.jpg`));
          options.onProgress?.(10 + Math.round(++done / total * 89));
        }
      levels.push({ width, cols, rows });
    }
    const manifest = {
      id,
      sha256,
      width: meta.width,
      height: meta.height,
      levels,
    };
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600 },
    );
    if (existsSync(final))
      throw Error("Media id exists. Use a new id to preserve originals.");
    check();
    renameSync(dir, final);
    options.onProgress?.(100);
    return manifest;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

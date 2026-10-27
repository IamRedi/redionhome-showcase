import { it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { importPanorama } from "../server/media.ts";
it("preserves original bytes and generates independently bound tiled derivatives", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "redionhome-media-"));
  try {
    const source = path.join(root, "source.jpg");
    await sharp({
      create: { width: 2048, height: 1024, channels: 3, background: "#647560" },
    })
      .jpeg()
      .toFile(source);
    const bytes = readFileSync(source),
      hash = createHash("sha256").update(bytes).digest("hex");
    const manifest = await importPanorama(source, root, "synthetic");
    expect(manifest.sha256).toBe(hash);
    expect(readFileSync(path.join(root, "media/synthetic/original"))).toEqual(
      bytes,
    );
    expect(
      statSync(path.join(root, "media/synthetic/original")).mode & 0o777,
    ).toBe(0o400);
    expect(manifest.levels).toEqual([{ width: 2048, cols: 4, rows: 2 }]);
    expect(existsSync(path.join(root, "media/synthetic/0-3-1.jpg"))).toBe(true);
    await expect(importPanorama(source, root, "synthetic")).rejects.toThrow(
      "exists",
    );
    expect(readFileSync(source)).toEqual(bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("rejects non-equirectangular inputs and traversal ids before writing", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "redionhome-media-"));
  try {
    const source = path.join(root, "source.jpg");
    await sharp({
      create: { width: 500, height: 500, channels: 3, background: "#647560" },
    })
      .jpeg()
      .toFile(source);
    await expect(importPanorama(source, root, "bad")).rejects.toThrow("2:1");
    expect(existsSync(path.join(root, "media/bad"))).toBe(false);
    await expect(importPanorama(source, root, "../escape")).rejects.toThrow(
      "Invalid media id",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("rejects an undersized 2:1 image without leaving a partial import", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "redionhome-media-"));
  try {
    const source = path.join(root, "small.jpg");
    await sharp({
      create: { width: 1024, height: 512, channels: 3, background: "#647560" },
    })
      .jpeg()
      .toFile(source);
    await expect(importPanorama(source, root, "small")).rejects.toThrow(
      "Minimum panorama width",
    );
    expect(existsSync(path.join(root, "media/small"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

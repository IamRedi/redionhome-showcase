import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
mkdirSync("assets/demo", { recursive: true });
for (const [id, file, expectedSha256] of [
  ["artist_workshop", "studio.jpg", "3d1a24d3255246fd53a3eeefca5b30dc0540c62406dd5be93ada1912557f61b1"],
  ["brown_photostudio_02", "lounge.jpg", "8f72aa337625c759016c7538aec6ee7624d9c243e8139120c96f9dbfde579636"],
]) {
  const target = path.resolve("assets/demo", file);
  if (!existsSync(target)) {
    const response = await fetch(
      `https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/${id}.jpg`,
      { signal: AbortSignal.timeout(60000) },
    );
    if (!response.ok) throw Error(`Demo download failed: ${response.status}`);
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    console.log(`Downloaded CC0 demo: ${id}`);
  }
  const actualSha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
  if (actualSha256 !== expectedSha256) {
    throw Error(`Demo checksum mismatch: ${file}`);
  }
  console.log(`Verified CC0 demo: ${file}`);
}

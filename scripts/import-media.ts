import { importPanorama } from "../server/media.ts";
import path from "node:path";
const [source, id] = process.argv.slice(2);
if (!source || !id)
  throw Error(
    "Usage: npm run media:import -- /absolute/panorama.jpg unique-media-id",
  );
const result = await importPanorama(
  path.resolve(source),
  path.resolve(process.env.DATA_DIR ?? ".data"),
  id,
);
console.log(
  `Imported ${result.id}; original SHA256 ${result.sha256}. Bind mediaId in the editor.`,
);

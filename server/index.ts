import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { createApp } from "./app.ts";
import { importPanorama } from "./media.ts";
import { HomeAssistantReadonlyAdapter } from "./adapters.ts";
import { pathToFileURL } from 'node:url';
import type { PhotoSuggestionProvider } from '../shared/photo-assistant.ts';
import { configuredPhotoProvider } from './photo-assistant.ts';
import {configuredAIProvider,type AIProvider} from './ai.ts';
export async function startServer(photoProvider?:PhotoSuggestionProvider, testOptions?:{loginRateLimit?:number;aiProvider?:AIProvider;clientDirectory?:string}) {
const root = path.resolve(process.env.DATA_DIR ?? ".data"),
  port = Number(process.env.PORT ?? 4173),
  host = process.env.HOST ?? "127.0.0.1";
const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
if (host !== "127.0.0.1" && host !== "::1" && !process.env.APP_ORIGIN)
  throw Error("Set an explicit APP_ORIGIN for a non-loopback bind");
const production = process.env.NODE_ENV === "production";
const adapter =
  process.env.HA_READONLY === "true"
    ? new HomeAssistantReadonlyAdapter(
        process.env.HA_URL ?? "",
        process.env.HA_TOKEN_FILE ?? "",
      )
    : undefined;
const { app, store, ha } = createApp({
  root,
  origin,
  production,
  adapter,
  password: process.env.OWNER_PASSWORD,
  photoProvider: photoProvider ?? configuredPhotoProvider(),
  aiProvider:testOptions?.aiProvider??configuredAIProvider(),
  haAllowedOrigins:(process.env.HA_ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean),
  haTokenFile:process.env.HA_TOKEN_FILE,
  haApprovedLightId:process.env.HA_APPROVED_LIGHT_ID,
  smartthingsTokenFile:process.env.ST_DIAGNOSTIC_TOKEN_FILE,
  tuyaConfigFile:process.env.TUYA_DIAGNOSTIC_CONFIG_FILE,
  loginRateLimit:testOptions?.loginRateLimit,
  runtimeLabel:process.env.RUNTIME_LABEL,
});
for (const [id, filename] of [
  ["atelier", "studio.jpg"],
  ["studio", "lounge.jpg"],
]) {
  if (!existsSync(path.join(root, "media", id, "manifest.json"))) {
    const source = path.resolve("assets/demo", filename);
    if (!existsSync(source))
      throw Error("Demo media missing: run npm run demo:fetch");
    await importPanorama(source, root, id);
  }
}
if (production) {
  const clientDirectory=testOptions?.clientDirectory??'dist';
  app.use(express.static(clientDirectory, { index: false, setHeaders(res,file) {
    res.setHeader('Cache-Control',file.includes(`${path.sep}assets${path.sep}`)?'public, max-age=31536000, immutable':'no-store');
  } }));
  app.use('/assets',(_req,res)=>{res.status(404).end();});
  app.get("/{*path}", (_req, res) =>
    res.set('Cache-Control','no-store').sendFile(path.resolve(clientDirectory,"index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer();
  app.use(vite.middlewares);
}
const server = app.listen(port, host, () => {
  console.log(`RediOnHome local: ${origin}`);
  console.log(
    "First-run owner password: DATA_DIR/owner-password.txt (private file; never commit).",
  );
});
const close = () => {
  ha.close();
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

return {server,store};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await startServer();

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildIdentity} from './scripts/build-identity.ts';
const identity=buildIdentity();
const outputDir=process.env.REDIONHOME_SHOWCASE_BUILD==='1'?'showcase-dist':'dist';
export default defineConfig({
  define:{__BUILD_ID__:JSON.stringify(identity.buildId),"import.meta.env.VITE_SHOWCASE":JSON.stringify(process.env.REDIONHOME_SHOWCASE_BUILD==='1'?'1':'0')},
  plugins: [react(),{
    name:'redionhome-release-identity',
    closeBundle(){
      const assets=readdirSync(`${outputDir}/assets`).map(name=>`/assets/${name}`).sort();
      // Warm only the entry shell. /ai must not download the lazy panorama chunk.
      // Other manifest assets are still cached on demand and retained for old tabs.
      const shell=[...readFileSync(`${outputDir}/index.html`,'utf8').matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match=>match[1]);
      const worker=readFileSync('public/sw.js','utf8').replace('__BUILD_ID__',identity.buildId).replace('/* __SHELL_ASSETS__ */',JSON.stringify(assets).slice(1,-1)).replace('/* __PRECACHE__ */',JSON.stringify(shell).slice(1,-1));
      writeFileSync(`${outputDir}/sw.js`,worker);
      const digests=Object.fromEntries(['index.html','sw.js',...assets.map(a=>a.slice(1))].map(file=>[file,createHash('sha256').update(readFileSync(`${outputDir}/${file}`)).digest('hex')]));
      writeFileSync(`${outputDir}/build.json`,JSON.stringify({...identity,assets:digests},null,2)+'\n');
    }
  }],
  build: {outDir:outputDir, chunkSizeWarningLimit: 1100 },
  server: { middlewareMode: true },
  appType: "spa",
});

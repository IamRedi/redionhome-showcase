import {createHash} from 'node:crypto';
import {readFileSync,copyFileSync,mkdirSync,readdirSync,existsSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import process from 'node:process';

export function verifyRelease(release) {
  const manifest=JSON.parse(readFileSync(path.join(release,'dist/build.json'),'utf8'));
  if(!/^[a-f0-9]{20}$/.test(manifest.buildId)||!manifest.assets?.['index.html']||!manifest.assets?.['sw.js'])throw Error('Invalid release manifest');
  for(const [name,digest] of Object.entries(manifest.assets)){
    if(!/^(index\.html|sw\.js|assets\/[A-Za-z0-9_.-]+)$/.test(name))throw Error('Invalid asset path');
    const file=path.join(release,'dist',name);
    if(lstatSync(file).isSymbolicLink()||createHash('sha256').update(readFileSync(file)).digest('hex')!==digest)throw Error('Release asset digest mismatch');
  }
  return manifest;
}
export function retainAssets(previous,candidate) {
  const from=path.join(previous,'dist/assets'),to=path.join(candidate,'dist/assets');
  mkdirSync(to,{recursive:true});
  for(const entry of readdirSync(from,{withFileTypes:true})){
    if(!entry.isFile())throw Error('Unexpected asset entry');
    const source=path.join(from,entry.name),destination=path.join(to,entry.name);
    if(existsSync(destination)){
      if(!readFileSync(source).equals(readFileSync(destination)))throw Error('Immutable asset collision');
    }else copyFileSync(source,destination);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  verifyRelease(process.argv[3]);
  retainAssets(process.argv[2],process.argv[3]);
}

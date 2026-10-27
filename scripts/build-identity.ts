import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';

// Includes uncommitted executable source. Excludes private data and timestamps.
export function buildIdentity(root=process.cwd()) {
  const files:string[]=[];
  function walk(dir:string) {
    for(const entry of readdirSync(path.join(root,dir),{withFileTypes:true})) {
      const file=path.posix.join(dir,entry.name);
      if(entry.isDirectory())walk(file);
      else if(entry.isFile())files.push(file);
    }
  }
  for(const dir of ['app','server','shared','public','scripts'])walk(dir);
  files.push('package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json');
  const hash=createHash('sha256');
  hash.update('build-mode:').update(process.env.REDIONHOME_SHOWCASE_BUILD==='1'?'offline-showcase':'application');
  for(const file of files.sort())hash.update(file).update('\0').update(readFileSync(path.join(root,file))).update('\0');
  const sourceHash=hash.digest('hex');
  let sourceCommit='uncommitted';
  try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* Archives use content digest. */}
  const migrations=[...readFileSync(path.join(root,'server/store.ts'),'utf8').matchAll(/INSERT INTO migrations VALUES\((\d+)\)/g)].map(m=>Number(m[1]));
  return {buildId:sourceHash.slice(0,20),sourceHash,sourceCommit,schemaRevision:Math.max(...migrations),apiVersion:1};
}

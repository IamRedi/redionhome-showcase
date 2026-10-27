import process from 'node:process';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),index=args.indexOf('--port');
const port=index<0?8780:Number(args[index+1]);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a port from 1024 to 65535');
const data=process.argv.includes('--container')?'/data':path.join(root,'.demo');
mkdirSync(data,{recursive:true});
if(lstatSync(data).isSymbolicLink())throw Error('The demo directory must not be a symlink');
const marker=path.join(data,'showcase-fixture.txt'),identity='redionhome-showcase-cc0-v1';
if(existsSync(path.join(data,'home.sqlite'))&&(!existsSync(marker)||readFileSync(marker,'utf8')!==identity))throw Error('Refusing to open an unknown database');
if(existsSync(marker)&&readFileSync(marker,'utf8')!==identity)throw Error('Unknown demo workspace');
writeFileSync(marker,identity,{mode:0o600});
const env={};
for(const key of ['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{HOME:data,USERPROFILE:data,TMPDIR:data,TEMP:data,TMP:data,
  NODE_ENV:'production',DATA_DIR:data,PORT:String(port),HOST:process.argv.includes('--container')?'0.0.0.0':'127.0.0.1',
  APP_ORIGIN:`http://127.0.0.1:${port}`,OWNER_PASSWORD:'showcase-local-demo-only',REDIONHOME_SHOWCASE:'1',
  RUNTIME_LABEL:''});
const child=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'scripts/offline-guard.mjs')).href,
  '--import','tsx',path.join(root,'scripts/showcase-runtime.ts')],{cwd:root,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));

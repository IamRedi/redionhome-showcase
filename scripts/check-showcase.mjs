import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import {log,error} from 'node:console';
const files=execFileSync('git',['ls-files','-z']).toString('utf8').split('\0').filter(Boolean);
const manifest=existsSync('docs/assets/media-manifest.json')?JSON.parse(readFileSync('docs/assets/media-manifest.json','utf8')):{media:[]};
const media=new Map(manifest.media.map(item=>[item.path,item.sha256]));
const issues=[];
for(const file of files){
  if(/(^|\/)(?:\.data|\.demo|\.test-data|backups|releases|node_modules|test-results|playwright-report|\.tailscale)(\/|$)|(^|\/)(AGENTS|CLAUDE)\.md$|\.(db|sqlite|pem|key|pfx|p12|zip|tgz|tar)$/i.test(file))issues.push(file+': private/runtime path');
  if(path.basename(file).startsWith('.env')&&path.basename(file)!=='.env.example')issues.push(file+': environment file');
  const bytes=readFileSync(file);
  if(/\.(png|jpe?g|webp|mp4|srt)$/i.test(file)&&!/(^|\/)public\/icon-(192|512)\.png$/.test(file)){
    if(media.get(file)!==createHash('sha256').update(bytes).digest('hex'))issues.push(file+': media absent from verified manifest');
  }
  if(!bytes.includes(0)&&file!=='scripts/check-showcase.mjs'){
    const text=bytes.toString('utf8');
    if(/tailbdeaae|redionhome-mobile|\/home\/redion|C:[/\\]Users[/\\]Lenovo|G95-1|75PUS906|60327a5de48dd111/.test(text))issues.push(file+': private installation metadata');
  }
}
for(const name of ['README.md','README.en.md'])if(existsSync(name))for(const link of readFileSync(name,'utf8').matchAll(/\]\(([^)]+)\)/g)){
  const target=link[1].split('#')[0];
  if(target&&!/^(https?:|mailto:)/.test(target)&&!existsSync(target))issues.push(name+': missing link '+target);
}
for(const issue of issues)error(issue);
log(`Publication surface: ${files.length} tracked files; ${issues.length} issues`);
if(issues.length)process.exit(1);

import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,cpSync,symlinkSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
// Disposable source builds only. No database, credentials, providers or home media.
const root=process.cwd(),fixtures=path.join(root,'.test-data/f0');
mkdirSync(fixtures,{recursive:true});
function run(command:string,args:string[],cwd:string){execFileSync(command,args,{cwd,stdio:['ignore','pipe','pipe']});}
const temp=mkdtempSync(path.join(fixtures,'source-'));
try{
  cpSync(path.join(root,'tests/fixtures/legacy-client'),temp,{recursive:true});
  symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
  run(path.join(root,'node_modules/.bin/vite'),['build'],temp);
  rmSync(path.join(fixtures,'legacy'),{recursive:true,force:true});
  cpSync(path.join(temp,'dist'),path.join(fixtures,'legacy'),{recursive:true});
  // Build B from the actual F0 source with a different HTML title.
  for(const item of ['app','server','shared','public','scripts','package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json']){
    cpSync(path.join(root,item),path.join(temp,item),{recursive:true});
  }
  const html=path.join(temp,'index.html');
  writeFileSync(html,readFileSync(html,'utf8').replace('<title>','<title>F0 successor Â· '));
  run(path.join(root,'node_modules/.bin/vite'),['build'],temp);
  rmSync(path.join(fixtures,'next'),{recursive:true,force:true});
  cpSync(path.join(temp,'dist'),path.join(fixtures,'next'),{recursive:true});
  // Both directions retain immutable assets, as the installer does.
  for(const dir of ['legacy','next'])cpSync(path.join(root,'dist/assets'),path.join(fixtures,dir,'assets'),{recursive:true});
  cpSync(path.join(fixtures,'legacy/assets'),path.join(fixtures,'next/assets'),{recursive:true});
  cpSync(path.join(fixtures,'next/assets'),path.join(root,'dist/assets'),{recursive:true});
  const pointer=path.join(root,'f0-client');
  rmSync(pointer,{force:true});
  symlinkSync(path.join(fixtures,'legacy'),pointer,'dir');
}finally{rmSync(temp,{recursive:true,force:true});}

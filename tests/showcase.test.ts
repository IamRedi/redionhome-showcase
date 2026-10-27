import {test,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('offline guard refuses external fetch, DNS and sockets before dispatch',()=>{
 const result=spawnSync(process.execPath,['--import',path.resolve('scripts/offline-guard.mjs'),'--input-type=module','-e',`
 import net from 'node:net';import dns from 'node:dns';let denied=0;
 for(const call of [()=>fetch('https://api.example.com'),()=>dns.lookup('api.example.com',()=>{}),()=>new net.Socket().connect({host:'8.8.8.8',port:443})]){try{await call();}catch(error){if(error.message.includes('Offline showcase'))denied++;}}
 console.log(JSON.stringify({denied}));`],{encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual({denied:3});
});
test('launcher refuses an existing unrecognized database',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'rdh-showcase-refuse-'));
 try{
  mkdirSync(path.join(root,'scripts'));mkdirSync(path.join(root,'.demo'));
  copyFileSync('scripts/serve-showcase.mjs',path.join(root,'scripts/serve-showcase.mjs'));
  writeFileSync(path.join(root,'.demo/home.sqlite'),'do not open');
  const result=spawnSync(process.execPath,[path.join(root,'scripts/serve-showcase.mjs')],{encoding:'utf8'});
  expect(result.status).not.toBe(0);expect(result.stderr).toContain('Refusing to open an unknown database');
 }finally{rmSync(root,{recursive:true,force:true});}
});

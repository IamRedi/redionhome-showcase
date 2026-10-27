import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,readlinkSync,rmSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as createSocketServer} from 'node:net';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.ts';
import {buildIdentity} from '../scripts/build-identity.ts';

test('installer backs up data, keeps old assets and refuses stale/concurrent installs',async()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'rdh-f0-install-'));
  const releases=path.join(root,'releases'),data=path.join(root,'data'),bin=path.join(root,'bin');
  mkdirSync(releases);mkdirSync(bin);
  const store=new Store(data),schema=store.db.prepare('SELECT max(version) FROM migrations').pluck().get();store.close();
  writeFileSync(path.join(data,'private-fixture'),'synthetic media');
  const socket=createSocketServer();
  socket.listen(path.join(data,'daemon.sock'));await once(socket,'listening');
  const previous=path.join(releases,'previous'),next=path.join(releases,'next'),other=path.join(releases,'other');
  function release(dir:string,id:string){
    mkdirSync(path.join(dir,'dist/assets'),{recursive:true});
    for(const folder of ['app','server','shared','public','scripts'])mkdirSync(path.join(dir,folder));
    for(const file of ['package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json'])writeFileSync(path.join(dir,file),id);
    writeFileSync(path.join(dir,'server/store.ts'),`INSERT INTO migrations VALUES(${schema})`);
    const files={'index.html':`<title>${id}</title>`,'sw.js':`// ${id}`,[`assets/${id}.js`]:`/* ${id} */`};
    const assets=Object.fromEntries(Object.entries(files).map(([name,body])=>{
      writeFileSync(path.join(dir,'dist',name),body);
      return [name,createHash('sha256').update(body).digest('hex')];
    }));
    writeFileSync(path.join(dir,'.source-sha'),'0'.repeat(40));
    writeFileSync(path.join(dir,'dist/build.json'),JSON.stringify({...buildIdentity(dir),sourceCommit:'0'.repeat(40),assets}));
  }
  release(previous,'a');release(next,'b');release(other,'c');
  const pointer=path.join(releases,'current');
  symlinkSync(previous,pointer);
  writeFileSync(path.join(bin,'systemctl'),'#!/bin/sh\nexit 0\n',{mode:0o700});
  const server=createServer((req,res)=>{
    if(req.url==='/api/v1/health')res.end('{"status":"ok"}');
    else res.end(readFileSync(path.join(readlinkSync(pointer),'dist/build.json')));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address() as {port:number};
  async function install(expected:string,candidate:string,name:string){
    const child=spawn('bash',['scripts/install-local-release.sh',expected,candidate,data,path.join(root,name)],{
      env:{...process.env,PATH:`${bin}:${process.env.PATH}`,REDIONHOME_HEALTH_URL:`http://127.0.0.1:${address.port}/api/v1/health`},stdio:['ignore','pipe','pipe']
    });
    let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    const [code]=await once(child,'close');return {code,output};
  }
  try{
    const success=await install(previous,next,'backup');
    expect(success.code,success.output).toBe(0);
    expect(readlinkSync(pointer)).toBe(next);
    expect(readFileSync(path.join(next,'dist/assets/a.js'),'utf8')).toBe('/* a */');
    expect(readFileSync(path.join(root,'backup/data/private-fixture'),'utf8')).toBe('synthetic media');
    expect(existsSync(path.join(root,'backup/data/daemon.sock'))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(root,'backup/manifest.json'),'utf8')).integrity).toBe('ok');
    const stale=await install(previous,other,'stale');
    expect(stale.code).not.toBe(0);expect(stale.output).toContain('pointer changed');
    expect(existsSync(path.join(root,'stale'))).toBe(false);
    const locker=spawn('flock',['--no-fork',path.join(releases,'.updater-state/update.lock'),'node','-e',"process.stdout.write('locked');setInterval(()=>{},1000)"]);
    await once(locker.stdout!,'data');
    try{const concurrent=await install(next,other,'concurrent');expect(concurrent.code).not.toBe(0);expect(concurrent.output).toContain('holds the lock');}
    finally{locker.kill('SIGTERM');await once(locker,'close');}
    expect(readlinkSync(pointer)).toBe(next);
    // A non-cooperating session changes the pointer during restart: rollback must stop.
    writeFileSync(path.join(bin,'systemctl'),`#!/bin/sh\nln -sfn '${previous}' '${pointer}'\nexit 1\n`,{mode:0o700});
    const raced=await install(next,other,'race');
    expect(raced.code).not.toBe(0);expect(raced.output).toContain('pointer changed');
    expect(readlinkSync(pointer)).toBe(previous);
    expect(readFileSync(path.join(data,'private-fixture'),'utf8')).toBe('synthetic media');
  }finally{server.close();socket.close();rmSync(root,{recursive:true,force:true});}
},20000);

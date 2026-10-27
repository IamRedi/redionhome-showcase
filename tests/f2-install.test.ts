import {test,expect} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,symlinkSync,readlinkSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {buildIdentity} from '../scripts/build-identity.ts';

async function fixture(){
 const root=mkdtempSync(path.join(os.tmpdir(),'rdh-f2-install-')),releases=path.join(root,'releases'),data=path.join(root,'data'),bin=path.join(root,'bin');mkdirSync(releases);mkdirSync(bin);
 const source=process.cwd(),previous=path.join(releases,'previous'),candidate=path.join(releases,'candidate'),log=path.join(root,'service.log');
 const storeSource=readFileSync('server/store.ts','utf8'),marker=storeSource.indexOf('    /** F2 schema'),home=storeSource.indexOf('  home(): Home');
 if(marker<0||home<marker)throw Error('Fixture could not locate additive migration boundary');
 for(const release of [previous,candidate]){
  mkdirSync(release);
  for(const name of ['app','server','shared','public','scripts','package.json','package-lock.json','index.html','vite.config.ts','tsconfig.json'])cpSync(path.join(source,name),path.join(release,name),{recursive:true});
  symlinkSync(realpathSync('node_modules'),path.join(release,'node_modules'),'dir');
  if(release===previous)writeFileSync(path.join(release,'server/store.ts'),storeSource.slice(0,marker)+'  }\n'+storeSource.slice(home));
  mkdirSync(path.join(release,'dist/assets'),{recursive:true});const id=release===previous?'previous':'candidate';
  const files={'index.html':`<title>${id}</title>`,'sw.js':`// ${id}`,[`assets/${id}.js`]:`// ${id}`};
  const assets=Object.fromEntries(Object.entries(files).map(([name,body])=>{writeFileSync(path.join(release,'dist',name),body);return [name,createHash('sha256').update(body).digest('hex')];}));
  writeFileSync(path.join(release,'.source-sha'),'0'.repeat(40));writeFileSync(path.join(release,'dist/build.json'),JSON.stringify({...buildIdentity(release),sourceCommit:'0'.repeat(40),assets}));
 }
 execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`const {Store}=await import(${JSON.stringify('file://'+path.join(previous,'server/store.ts'))});new Store(${JSON.stringify(data)}).close();`],{cwd:source});
 writeFileSync(path.join(data,'private-fixture'),'synthetic-private-content');writeFileSync(path.join(bin,'systemctl'),'#!/bin/sh\nprintf "%s\\n" "$*" >> "$F2_SERVICE_LOG"\nexit 0\n',{mode:0o700});
 const pointer=path.join(releases,'current');symlinkSync(previous,pointer);let failHealth=false;
 const server=createServer((req,res)=>{if(failHealth&&readlinkSync(pointer)===candidate){res.statusCode=503;res.end('failed');return;}res.end(req.url==='/api/v1/health'?'{}':readFileSync(path.join(readlinkSync(pointer),'dist/build.json')));});server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
 const run=async(script:string,backup:string,approve=true)=>{
  const args=[script,previous,candidate,data,path.join(root,backup),...(approve?['--migrate-7-to-8']:[])];
  const child=spawn('bash',args,{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,F2_SERVICE_LOG:log,REDIONHOME_HEALTH_URL:`http://127.0.0.1:${port}/api/v1/health`},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const [code]=await once(child,'close');return {code,output};
 };
 const schema=()=>{const db=new Database(path.join(data,'home.sqlite'),{readonly:true,fileMustExist:true});const version=db.prepare('SELECT max(version) FROM migrations').pluck().get();db.close();return version;};
 return {root,data,previous,candidate,pointer,log,run,schema,failHealth:()=>{failHealth=true;},close:async()=>{server.close();await once(server,'close');rmSync(root,{recursive:true,force:true});}};
}

test('F2 installation requires the explicit migration gate and ordinary installer remains fail closed',async()=>{
 const f=await fixture();try{
  expect((await f.run('scripts/install-f2-release.sh','unapproved',false)).code).toBe(2);expect(existsSync(f.log)).toBe(false);expect(f.schema()).toBe(7);
  const ordinary=await f.run('scripts/install-local-release.sh','ordinary',false);expect(ordinary.code).not.toBe(0);expect(ordinary.output).toContain('migration rehearsal required');expect(readlinkSync(f.pointer)).toBe(f.previous);expect(f.schema()).toBe(7);
 }finally{await f.close();}
},20000);
test('approved F2 installation rehearses rollback, preserves data and refuses a stale pointer',async()=>{
 const f=await fixture();try{
  const result=await f.run('scripts/install-f2-release.sh','approved');expect(result.code,result.output).toBe(0);expect(f.schema()).toBe(8);expect(readlinkSync(f.pointer)).toBe(f.candidate);expect(readFileSync(path.join(f.data,'private-fixture'),'utf8')).toBe('synthetic-private-content');expect(existsSync(path.join(f.root,'approved/migration-rehearsal/evidence.json'))).toBe(true);
  const db=new Database(path.join(f.data,'home.sqlite'),{readonly:true});expect(db.prepare('SELECT count(*) FROM action_policies').pluck().get()).toBe(0);expect(db.prepare('SELECT count(*) FROM action_runs').pluck().get()).toBe(0);db.close();
  const stale=await f.run('scripts/install-f2-release.sh','stale');expect(stale.code).not.toBe(0);expect(stale.output).toContain('pointer changed');expect(existsSync(path.join(f.root,'stale'))).toBe(false);
 }finally{await f.close();}
},20000);
test('F2 health failure restores code while preserving additive schema and the original backup',async()=>{
 const f=await fixture();f.failHealth();try{
  const result=await f.run('scripts/install-f2-release.sh','rollback');expect(result.code).not.toBe(0);expect(readlinkSync(f.pointer)).toBe(f.previous);expect(f.schema()).toBe(8);expect(result.output).toContain('database was not restored');const backup=new Database(path.join(f.root,'rollback/home.sqlite'),{readonly:true});expect(backup.prepare('SELECT max(version) FROM migrations').pluck().get()).toBe(7);backup.close();expect(readFileSync(path.join(f.data,'private-fixture'),'utf8')).toBe('synthetic-private-content');
 }finally{await f.close();}
},25000);

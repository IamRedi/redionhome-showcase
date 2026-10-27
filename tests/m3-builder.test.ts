import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createApp} from '../server/app.ts';
import {importPanorama} from '../server/media.ts';
const origin='http://127.0.0.1:4192',password='synthetic-m3-owner-password';
let root:string,service:ReturnType<typeof createApp>,owner:string;
const get=(url:string,cookie=owner)=>request(service.app).get(`/api/v1${url}`).set('Host','127.0.0.1:4192').set('Cookie',cookie);
const post=(url:string,body:unknown,cookie=owner)=>request(service.app).post(`/api/v1${url}`).set('Host','127.0.0.1:4192').set('Origin',origin).set('Cookie',cookie).send(body as object);
const photo=(width=2048,height=1024)=>sharp({create:{width,height,channels:3,background:'#607b50'}}).jpeg().toBuffer();
beforeEach(async()=>{root=mkdtempSync(path.join(os.tmpdir(),'redionhome-m3-'));service=createApp({root,origin,password,production:true});const r=await post('/login',{password},'');owner=r.headers['set-cookie'][0].split(';')[0];});
afterEach(()=>{service.store.close();rmSync(root,{recursive:true,force:true});});
async function uploaded(bytes:Buffer){const r=await request(service.app).post('/api/v1/panorama-imports').set('Host','127.0.0.1:4192').set('Origin',origin).set('Cookie',owner).set('Content-Type','application/octet-stream').send(bytes);expect(r.status).toBe(202);let result=r.body;await vi.waitFor(async()=>{result=(await get(`/panorama-imports/${r.body.id}`)).body;expect(result.status).not.toBe('processing');});return result;}
it('phone panorama upload creates immutable originals and ready tiles without changing the home',async()=>{
 const before=service.store.home(),bytes=await photo();const job=await uploaded(bytes);expect(job.status).toBe('ready');expect(job.progress).toBe(100);
 expect(readFileSync(path.join(root,'media',job.mediaId,'original'))).toEqual(bytes);expect(service.store.home()).toEqual(before);
 expect((await get('/panoramas')).body.some((m:{id:string})=>m.id===job.mediaId)).toBe(true);
 const m=(await get(`/media/${job.mediaId}/manifest`)).body;expect(m.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(m.levels).toHaveLength(1);
 expect((await get(`/media/${job.mediaId}/original`)).status).toBe(404);
});
it('room creation and replacement preserve every original object, hotspot and historical revision',async()=>{
 const job=await uploaded(await photo()),before=service.store.home();
 const room=await post('/rooms',{expectedRevision:before.revision,homeName:'Universal studio',name:'New room',mediaId:job.mediaId,initial:{yaw:0.4,pitch:0}});
 expect(room.status).toBe(201);expect(room.body.home.name).toBe('Universal studio');expect(room.body.home.scenes).toHaveLength(before.scenes.length+1);expect(room.body.home.objects).toEqual(before.objects);
 const replaced=await post('/rooms',{expectedRevision:room.body.home.revision,replaceSceneId:before.scenes[0].id,name:'Renamed room',mediaId:job.mediaId,initial:{yaw:1,pitch:-0.1}});
 expect(replaced.status).toBe(201);expect(replaced.body.home.objects).toEqual(before.objects);expect(replaced.body.home.scenes[0].hotspots).toEqual(before.scenes[0].hotspots);
 expect(JSON.parse((service.store.db.prepare('SELECT document FROM revisions WHERE revision=?').get(before.revision) as {document:string}).document)).toEqual(before);
 const conflict=await post('/rooms',{expectedRevision:before.revision,name:'Stale',mediaId:job.mediaId,initial:{yaw:0,pitch:0}});expect(conflict.status).toBe(409);
 const restored=await post('/restore',{revision:before.revision,expectedRevision:replaced.body.home.revision});expect(restored.status).toBe(200);expect(restored.body.scenes).toEqual(before.scenes);expect(existsSync(path.join(root,'media',job.mediaId,'original'))).toBe(true);
});
it('invalid ratio, format and EXIF orientation do not produce bindable panorama media',async()=>{
 for(const [bytes,code] of [[await photo(500,500),'INVALID_PANORAMA'],[Buffer.from('not an image'),'INVALID_PANORAMA'],[await sharp(await photo()).withMetadata({orientation:3}).jpeg().toBuffer(),'PANORAMA_ORIENTATION']] as const){const job=await uploaded(bytes);expect(job.status).toBe('failed');expect(job.error).toBe(code);expect(job.mediaId).toBeUndefined();}
 expect(readdirSync(root).some(p=>p.startsWith('.panorama-'))).toBe(false);
});
it('cancel stops tile generation at a deterministic boundary and removes only the staged import',async()=>{
 const source=path.join(root,'source.jpg');writeFileSync(source,await photo());const controller=new AbortController();
 await expect(importPanorama(source,root,'cancelled',{signal:controller.signal,onProgress:p=>{if(p>10)controller.abort();}})).rejects.toThrow('IMPORT_CANCELLED');
 expect(existsSync(path.join(root,'media/cancelled'))).toBe(false);expect(readdirSync(path.join(root,'media')).some(p=>p.startsWith('.import-'))).toBe(false);expect(existsSync(source)).toBe(true);
});
it('tile seam and orientation follow an upright 2:1 synthetic source',async()=>{
 const w=2048,h=1024,data=Buffer.alloc(w*h*3);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*3;data[i]=Math.round(120+80*Math.cos(x/w*Math.PI*2));data[i+1]=Math.round(y/h*200);data[i+2]=50;}
 const source=path.join(root,'seam.png');await sharp(data,{raw:{width:w,height:h,channels:3}}).png().toFile(source);await importPanorama(source,root,'seam');
 const left=await sharp(path.join(root,'media/seam/0-0-0.jpg')).raw().toBuffer();const right=await sharp(path.join(root,'media/seam/0-3-0.jpg')).raw().toBuffer();
 for(let c=0;c<3;c++)expect(Math.abs(left[(256*512)*3+c]-right[(256*512+511)*3+c])).toBeLessThan(8);
 expect(left[1]).toBeLessThan(left[(511*512)*3+1]);
});
it('unauthenticated users cannot import, cancel, inspect jobs or create rooms',async()=>{
 for(const url of ['/panoramas','/panorama-imports/unknown'])expect((await get(url,'')).status).toBe(401);
 expect((await post('/rooms',{},'')).status).toBe(401);expect((await post('/panorama-imports',{},'')).status).toBe(401);
 expect((await request(service.app).delete('/api/v1/panorama-imports/unknown').set('Host','127.0.0.1:4192').set('Origin',origin)).status).toBe(401);
});
it('creating and switching private homes preserves the previous space and enforces revision conflicts',async()=>{
 const original=service.store.home();expect((await get('/panoramas')).body).toEqual([]);
 const job=await uploaded(await photo());
 const created=await post('/homes',{expectedRevision:original.revision,homeName:'My new home',name:'First room',mediaId:job.mediaId,initial:{yaw:0,pitch:0}});
 expect(created.status).toBe(201);expect(created.body.home.id).not.toBe(original.id);expect(created.body.home.objects).toEqual([]);expect(created.body.home.scenes[0].visibility).toBe('private');
 const list=await get('/homes');expect(list.body).toHaveLength(2);expect(list.body.map((h:{id:string})=>h.id)).toContain(original.id);
 expect((await post(`/homes/${original.id}/activate`,{expectedRevision:original.revision})).status).toBe(409);
 const restored=await post(`/homes/${original.id}/activate`,{expectedRevision:created.body.home.revision});expect(restored.status).toBe(200);expect(restored.body.home.objects).toEqual(original.objects);expect(restored.body.home.scenes).toEqual(original.scenes);
 expect((await post(`/homes/${created.body.home.id}/activate`,{expectedRevision:restored.body.home.revision})).body.home.name).toBe('My new home');
 expect((await get('/homes','')).status).toBe(401);expect((await post('/homes',{},'')).status).toBe(401);expect((await post(`/homes/${original.id}/activate`,{},'')).status).toBe(401);
 expect(service.store.db.prepare('SELECT publication_id FROM exposure').all()).toEqual([{publication_id:null},{publication_id:null}]);
});
it('only explicitly configured private HTTPS origin is trusted, with secure cookies and same-origin writes',async()=>{
 const privateOrigin='https://synthetic.tailtest.ts.net';writeFileSync(path.join(root,'phone-access.json'),JSON.stringify({origin:privateOrigin}));
 const login=await request(service.app).post('/api/v1/login').set('Host','synthetic.tailtest.ts.net').set('Origin',privateOrigin).send({password});expect(login.status).toBe(200);expect(login.headers['set-cookie'][0]).toContain('Secure');
 const cookie=login.headers['set-cookie'][0].split(';')[0];
 expect((await request(service.app).get('/api/v1/home').set('Host','synthetic.tailtest.ts.net').set('Cookie',cookie)).status).toBe(200);
 expect((await request(service.app).post('/api/v1/login').set('Host','synthetic.tailtest.ts.net').set('Origin',origin).send({password})).status).toBe(403);
 expect((await request(service.app).get('/api/v1/home').set('Host','other.tailtest.ts.net').set('Cookie',cookie)).status).toBe(403);
 writeFileSync(path.join(root,'phone-access.json'),JSON.stringify({origin:'https://attacker.example'}));
 expect((await request(service.app).get('/api/v1/home').set('Host','attacker.example').set('Cookie',cookie)).status).toBe(403);
 expect((await get('/phone-access','')).status).toBe(401);
});

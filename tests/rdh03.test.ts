import {it,expect,beforeEach,afterEach} from 'vitest';
import request from 'supertest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createApp} from '../server/app.ts';
import {homeSchema} from '../shared/model.ts';
const origin='http://127.0.0.1:4197',password='synthetic-rdh03-password';
let root:string,service:ReturnType<typeof createApp>,owner:string;
const get=(url:string,cookie=owner)=>request(service.app).get(`/api/v1${url}`).set('Host','127.0.0.1:4197').set('Cookie',cookie);
const post=(url:string,body:unknown,cookie=owner)=>request(service.app).post(`/api/v1${url}`).set('Host','127.0.0.1:4197').set('Origin',origin).set('Cookie',cookie).send(body as object);
const save=(body:unknown)=>request(service.app).put('/api/v1/home').set('Host','127.0.0.1:4197').set('Origin',origin).set('Cookie',owner).send(body as object);
beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'redionhome-rdh03-'));
 service=createApp({root,origin,password,production:true});
 owner=(await post('/login',{password},'')).headers['set-cookie'][0].split(';')[0];
 const image=await sharp({create:{width:256,height:128,channels:3,background:'#3c7259'}}).jpeg().toBuffer();
 for(const id of ['atelier','studio']){const dir=path.join(root,'media',id);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'preview.jpg'),image);writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id,width:2048,height:1024,levels:[{width:2048,cols:4,rows:2}]}));}
});
afterEach(()=>{service.store.close();rmSync(root,{recursive:true,force:true});});
const journal=(text:string)=>({id:`note-${Math.abs(hash(text))}`,at:Date.now(),text});
function hash(value:string){let h=0;for(const character of value)h=(h*31+character.charCodeAt(0))|0;return h;}

it('paired fridge demo is a browser-only demo action alongside piano, led-wall and robot',async()=>{
 const home=service.store.home();
 const artwork=home.objects.find(o=>o.id==='artwork')!;
 artwork.actions=[...artwork.actions.filter(a=>a.type!=='demo'),{type:'demo',demo:'fridge'}];
 expect(homeSchema.safeParse(home).success).toBe(true);
 expect((await save(home)).status).toBe(200);
});

it('journal entries live only on the private profile and never on showroom or legacy objects',()=>{
 const home=service.store.home();
 const artwork=home.objects.find(o=>o.id==='artwork')!;
 artwork.experiences={version:1,private:{version:1,journal:[journal('Ditë 1 · shënim privat i pronarit')]}};
 expect(homeSchema.safeParse(home).success).toBe(true);
 const leaked={...home,objects:home.objects.map(o=>o.id==='artwork'?{...o,experiences:{version:1,showroom:{version:1,journal:[journal('leak')]}}}:o)};
 expect(homeSchema.safeParse(leaked).success).toBe(false);
 const legacy={...home,objects:home.objects.map(o=>o.id==='artwork'?{...o,journal:[journal('leak')]}:o)};
 expect(homeSchema.safeParse(legacy).success).toBe(false);
 const oversized=structuredClone(home);oversized.objects.find(o=>o.id==='artwork')!.experiences!.private!.journal=[journal('x'.repeat(2001))];
 expect(homeSchema.safeParse(oversized).success).toBe(false);
});

it('journal saves privately through the API while an empty note is named without echoing values',async()=>{
 const home=service.store.home();
 const artwork=home.objects.find(o=>o.id==='artwork')!;
 artwork.experiences={version:1,private:{version:1,journal:[journal('Shënim privat: manuali i frigoriferit')]}}
 expect((await save(home)).status).toBe(200);
 const stored=service.store.home().objects.find(o=>o.id==='artwork')!;
 expect(stored.experiences?.private?.journal?.[0]?.text).toBe('Shënim privat: manuali i frigoriferit');
 const bad=structuredClone(service.store.home());
 bad.objects.find(o=>o.id==='artwork')!.experiences!.private!.journal=[{id:'note-empty',at:Date.now(),text:'   '}];
 const result=await save(bad);
 expect(result.status).toBe(400);
 expect(result.body.error).toBe('INVALID_INPUT');
 expect(JSON.stringify(result.body)).not.toContain('Shënim');
 expect(service.store.home().revision).toBe(bad.revision);
});

it('publications export the browser-only fridge demo but never the private journal',async()=>{
 const home=service.store.home();
 home.scenes[0].visibility='public';
 const artwork=home.objects.find(o=>o.id==='artwork')!;
 artwork.visibility='public';
 artwork.actions=[...artwork.actions.filter(a=>a.type!=='demo'),{type:'demo',demo:'fridge'}];
 artwork.experiences={version:1,private:{version:1,journal:[journal('SEKRET: kodi i shtëpisë 4832')]}};
 expect((await save(home)).status).toBe(200);
 const current=service.store.home();
 const selection={title:'RDH-03 preview',audience:'public' as const,sceneIds:[current.scenes[0].id],objectIds:['artwork'],mediaIds:['atelier'],expectedRevision:current.revision};
 const draft=await post('/publications',selection);
 expect(draft.status).toBe(201);
 expect((await post(`/publications/${draft.body.id}/activate`,{approved:true})).status).toBe(200);
 const snapshot=(await get(`/tours/${draft.body.id}/home`,'')).body;
 const text=JSON.stringify(snapshot);
 expect(text).toContain('"fridge"');
 expect(text).not.toContain('SEKRET');
 expect(text).not.toContain('journal');
 expect(text).not.toContain('4832');
});

import {it,expect,beforeEach,afterEach} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createApp} from '../server/app.ts';
import {preserveDevice, withoutDevice, managedDevice} from '../shared/editor.ts';
import type {Home} from '../shared/model.ts';
const origin='http://127.0.0.1:4199',password='synthetic-binding-password';
let root:string,service:ReturnType<typeof createApp>,owner:string;
const post=(url:string,body:unknown,cookie=owner)=>request(service.app).post(`/api/v1${url}`).set('Host','127.0.0.1:4199').set('Origin',origin).set('Cookie',cookie).send(body as object);
const putHome=(body:unknown)=>request(service.app).put('/api/v1/home').set('Host','127.0.0.1:4199').set('Origin',origin).set('Cookie',owner).send(body as object);
beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'redionhome-binding-'));
 service=createApp({root,origin,password,production:true});
 owner=(await post('/login',{password},'')).headers['set-cookie'][0].split(';')[0];
 const image=await sharp({create:{width:256,height:128,channels:3,background:'#3c7259'}}).jpeg().toBuffer();
 for(const id of ['atelier','studio']){const dir=path.join(root,'media',id);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'preview.jpg'),image);writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id,width:2048,height:1024,levels:[{width:2048,cols:4,rows:2}]}));}
});
afterEach(()=>{service.store.close();rmSync(root,{recursive:true,force:true});});

it('presentation edits can never replace a managed device identity',()=>{
 const original={id:'light',roomId:'atelier',name:'Drita',description:'',kind:'light' as const,
   provider:{identity:'light',active:'home-assistant' as const,status:'configured' as const},
   actions:[{type:'device' as const,bindingId:'ha-1'},{type:'info' as const}]};
 expect(managedDevice(original)).toBe(true);
 const reckless={...original,provider:undefined,actions:[{type:'info' as const},{type:'device' as const,bindingId:'demo-light'}]} as unknown as typeof original;
 const guarded=preserveDevice(original,reckless);
 expect(guarded.provider).toEqual(original.provider);
 expect(guarded.actions.filter(a=>a.type==='device').map(a=>a.bindingId)).toEqual(['ha-1']);
 expect(managedDevice(withoutDevice(original))).toBe(false);
 expect(withoutDevice(original).actions.some(a=>a.type==='device'||a.type==='integration')).toBe(false);
});

it('binding edit moves the exact identity in one transaction and refuses unconfirmed or conflicting calls',async()=>{
 const home:Home=service.store.home();
 const light=home.objects.find(o=>o.actions.some(a=>a.type==='device'))!;
 const target=home.objects.find(o=>o.id!==light.id&&!o.actions.some(a=>a.type==='device')&&!o.provider&&
   home.scenes.some(scene=>scene.hotspots.some(hotspot=>hotspot.objectId===o.id))&&!o.parentId)!;
 expect(light).toBeDefined();
 expect(target).toBeDefined();
 service.store.db.prepare("INSERT INTO ha_bindings(binding_id,object_id,entity_id,control_enabled) VALUES('demo-light',?, 'light.editable', 1)").run(light.id);
 const seeded=structuredClone(home);
 seeded.objects.find(o=>o.id===light.id)!.provider={identity:light.id,active:'home-assistant',status:'configured'};
 expect((await putHome(seeded)).status).toBe(200);
 const revision=service.store.home().revision;

 const unconfirmed=await post('/bindings/edit',{objectId:light.id,expectedRevision:revision,confirm:false,operation:'move',targetObjectId:target.id});
 expect(unconfirmed.status).toBe(400);
 const conflict=await post('/bindings/edit',{objectId:light.id,expectedRevision:revision+5,confirm:true,operation:'move',targetObjectId:target.id});
 expect([400,409]).toContain(conflict.status);

 const moved=await post('/bindings/edit',{objectId:light.id,expectedRevision:revision,confirm:true,operation:'move',targetObjectId:target.id});
 expect(moved.status).toBe(200);
 const next=service.store.home();
 expect(next.objects.find(o=>o.id===light.id)!.actions.filter(a=>a.type==='device')).toHaveLength(0);
 expect(next.objects.find(o=>o.id===target.id)!.actions.filter(a=>a.type==='device')).toHaveLength(1);
 expect(next.revision).toBe(revision+1);
 expect(service.store.db.prepare('SELECT object_id FROM ha_bindings WHERE binding_id=?').pluck().get('demo-light')).toBe(target.id);

 const detached=await post('/bindings/edit',{objectId:target.id,expectedRevision:next.revision,confirm:true,operation:'detach'});
 expect(detached.status).toBe(200);
 const after=service.store.home();
 expect(after.objects.find(o=>o.id===target.id)!.actions.filter(a=>a.type==='device')).toHaveLength(0);
 expect(service.store.db.prepare('SELECT 1 FROM ha_bindings WHERE binding_id=?').get('demo-light')).toBeUndefined();
 expect(after.revision).toBe(next.revision+1);
});

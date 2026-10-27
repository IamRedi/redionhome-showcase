import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,chmodSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {createApp,passwordHash} from '../server/app.ts';
import {SmartThingsReadOnly} from '../server/smartthings.ts';
import {Store} from '../server/store.ts';

const origin='http://127.0.0.1:4197',password='synthetic-owner-password-42';
const id='80e26532-85d4-484c-b012-1c04f3d35f95';
let root:string,tokenFile:string,service:ReturnType<typeof createApp>,owner:string,state:'on'|'off',health:'ONLINE'|'OFFLINE',calls:string[],now:number;
const fakeFetch:typeof fetch=async(input,init)=>{
 const url=new URL(String(input));calls.push(`${init?.method}:${url.href}`);
 if(url.origin!=='https://api.smartthings.com'||init?.method!=='GET'||new Headers(init.headers).get('Authorization')!=='Bearer synthetic-st-token')throw Error('unexpected request');
 if(url.pathname==='/v1/devices')return Response.json({items:[{deviceId:id,label:'Test light',components:[{id:'main',capabilities:[{id:'switch'}]}]}],_links:{}});
 if(url.pathname===`/v1/devices/${id}/health`)return Response.json({deviceId:id,state:health,lastUpdatedDate:'2026-10-13T12:00:00Z'});
 if(url.pathname===`/v1/devices/${id}/status`)return Response.json({components:{main:{switch:{switch:{value:state,timestamp:'2026-10-13T12:00:00Z'}}}}});
 throw Error('unexpected path');
};
const get=(route:string,cookie=owner)=>request(service.app).get(`/api/v1${route}`).set('Host','127.0.0.1:4197').set('Cookie',cookie);
const post=(route:string,body:object={},cookie=owner)=>request(service.app).post(`/api/v1${route}`).set('Host','127.0.0.1:4197').set('Origin',origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie',cookie).send(body);
beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'redionhome-m4b-'));tokenFile=path.join(root,'st-token');writeFileSync(tokenFile,'synthetic-st-token\n');chmodSync(tokenFile,0o600);
 state='off';health='ONLINE';calls=[];now=0;
 service=createApp({root,origin,password,production:true,smartthingsTokenFile:tokenFile,smartthingsFetch:fakeFetch,smartthingsNow:()=>now});
 const login=await post('/login',{password},'');owner=login.headers['set-cookie'][0].split(';')[0];
});
afterEach(()=>{service.ha.close();service.store.close();rmSync(root,{recursive:true,force:true});});

it('fails closed without diagnostic credential and never sends commands',async()=>{
 const client=new SmartThingsReadOnly(undefined,fakeFetch);
 await expect(client.discover()).rejects.toThrow('ST_AUTH_BLOCKED');
 expect(calls).toHaveLength(0);
 const home=service.store.home();
 const bound=await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 expect(bound.status).toBe(201);
 const denied=await post('/commands',{objectId:'light',action:'turn_on'});
 expect(denied.status).toBe(403);expect(denied.body.error).toBe('REAL_COMMANDS_PHASE_2_LOCKED');
 expect(calls.every(call=>call.startsWith('GET:'))).toBe(true);
});

it('requires owner confirmation, a real hotspot, and unique provider identity',async()=>{
 const home=service.store.home();
 expect((await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:false})).status).toBe(400);
 expect((await post('/smartthings/bind',{objectId:'missing',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true})).status).toBe(400);
 const first=await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 expect(first.status).toBe(201);
 expect((await get('/device-registry')).body).toEqual([expect.objectContaining({objectId:'light',provider:'smartthings',externalId:id,confirmedBy:'owner'})]);
 expect((await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:first.body.revision,confirmSamePhysicalDevice:true})).status).toBe(409);
 expect((await get('/smartthings/bindings')).body).toHaveLength(1);
});

it('imports SmartThings into the unified catalogue without enabling direct commands',async()=>{
 const report=await post('/unified-devices/discover');expect(report.status).toBe(200);
 expect(report.body.devices).toEqual([expect.objectContaining({provider:'smartthings',externalId:id,name:'Test light',capabilities:['power'],commandCapabilities:[],availability:'online',objectId:null})]);
 const home=service.store.home();const added=await post('/unified-devices/add',{provider:'smartthings',externalId:id,expectedRevision:home.revision,sceneId:'atelier-view',position:{yaw:-0.7,pitch:0.1},confirmSamePhysicalDevice:true});
 expect(added.status).toBe(201);expect(added.body.controlEnabled).toBe(false);
 expect((await post('/commands',{objectId:added.body.objectId,action:'turn_on'})).body.error).toBe('REAL_COMMANDS_PHASE_2_LOCKED');
 expect(calls.every(call=>call.startsWith('GET:'))).toBe(true);
});

it('reads changing external state and keeps viewer and guest paths closed',async()=>{
 const home=service.store.home();await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 let device=(await get('/devices')).body.entities.find((e:{source:string})=>e.source==='smartthings');
 expect(device.state).toBe('off');state='on';
 expect((await get('/devices')).body.entities.find((e:{source:string})=>e.source==='smartthings').state).toBe('off');
 now=10_001;
 device=(await get('/devices')).body.entities.find((e:{source:string})=>e.source==='smartthings');
 expect(device.state).toBe('on');
 service.store.db.prepare('INSERT INTO users VALUES(?,?,?)').run('viewer',passwordHash(password),'viewer');
 const login=await post('/login',{username:'viewer',password},'');const viewer=login.headers['set-cookie'][0].split(';')[0];
 expect((await get('/smartthings/discover',viewer)).status).toBe(403);
 expect((await get('/device-registry',viewer)).status).toBe(403);
 expect((await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true},viewer)).status).toBe(403);
 expect((await get('/smartthings/discover','')).status).toBe(401);
});

it('reports an offline device as unavailable instead of showing its stale switch state',async()=>{
 const home=service.store.home();await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 health='OFFLINE';
 const device=(await get('/devices')).body.entities.find((e:{source:string})=>e.source==='smartthings');
 expect(device.state).toBe('unavailable');
 expect(device.observedAt).toBe('2026-10-13T12:00:00Z');
 expect(calls.some(call=>call.includes(`/v1/devices/${id}/status`))).toBe(false);
 health='ONLINE';state='on';now=10_001;
 const fresh=(await get('/devices')).body.entities.find((e:{source:string})=>e.source==='smartthings');
 expect(fresh.state).toBe('on');
});

it('preserves the object and its media when a read-only identity is unlinked',async()=>{
 const home=service.store.home();const bound=await post('/smartthings/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 const unbound=await post('/smartthings/unbind',{objectId:'light',expectedRevision:bound.body.revision});
 expect(unbound.status).toBe(200);
 expect(unbound.body.objects.find((o:{id:string})=>o.id==='light').mediaId).toBe(home.objects.find(o=>o.id==='light')?.mediaId);
 expect((await get('/device-registry')).body).toHaveLength(0);
});

it('rejects unsafe token modes, untrusted pagination and stale state',async()=>{
 chmodSync(tokenFile,0o644);
 await expect(new SmartThingsReadOnly(tokenFile,fakeFetch).discover()).rejects.toThrow('ST_TOKEN_FILE_UNSAFE');
 chmodSync(tokenFile,0o600);
 const unsafe:typeof fetch=async()=>Response.json({items:[],_links:{next:{href:'https://attacker.example/v1/devices'}}});
 await expect(new SmartThingsReadOnly(tokenFile,unsafe).discover()).rejects.toThrow('ST_URL_NOT_ALLOWED');
});

it('backfills an M4A HA identity once without changing revision or audit history',()=>{
 const original=service.store.home();
 const count=(service.store.db.prepare('SELECT count(*) AS total FROM audit').get() as {total:number}).total;
 service.ha.close();service.store.close();
 const db=new Store(root);
 db.db.exec('DROP TABLE provider_identities; DROP TABLE canonical_devices; DELETE FROM migrations WHERE version=5;');
 db.db.prepare('INSERT INTO ha_bindings(binding_id,object_id,entity_id) VALUES(?,?,?)').run('ha-test','light','light.synthetic');
 db.close();
 const migrated=new Store(root);
 const rows=migrated.db.prepare('SELECT c.object_id,p.provider,p.external_id FROM canonical_devices c JOIN provider_identities p ON p.device_id=c.id').all();
 expect(rows).toEqual([{object_id:'light',provider:'home-assistant',external_id:'light.synthetic'}]);
 expect(migrated.home()).toEqual(original);
 expect((migrated.db.prepare('SELECT count(*) AS total FROM audit').get() as {total:number}).total).toBe(count);
 migrated.close();
 service=createApp({root,origin,password,production:true,smartthingsTokenFile:tokenFile,smartthingsFetch:fakeFetch,smartthingsNow:()=>now});
});

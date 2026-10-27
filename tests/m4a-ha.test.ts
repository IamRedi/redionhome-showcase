import {afterEach,beforeEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,chmodSync,mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {createApp,passwordHash} from '../server/app.ts';
import {validateHaOrigin} from '../server/home-assistant.ts';

const origin='http://127.0.0.1:4196',haOrigin='http://127.0.0.1:8123',password='synthetic-owner-password-42';
class FakeSocket extends EventTarget {sent:string[]=[];send(value:string){this.sent.push(value);}close(){this.dispatchEvent(new Event('close'));}}
let root:string,tokenFile:string,service:ReturnType<typeof createApp>,owner:string,lightState:string,switchState:string,brightness:number,services:number,socket:FakeSocket;
let validToken=true;
async function handshake(){
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'auth_required'})}));
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'auth_ok'})}));
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'result',id:1,success:true})}));
 await new Promise(resolve=>setTimeout(resolve,0));
}
const get=(route:string,cookie=owner)=>request(service.app).get(`/api/v1${route}`).set('Host','127.0.0.1:4196').set('Cookie',cookie);
const post=(route:string,body:object={},cookie=owner)=>request(service.app).post(`/api/v1${route}`).set('Host','127.0.0.1:4196').set('Origin',origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie',cookie).send(body);
const fakeFetch:typeof fetch=async(input,init)=>{
 const url=new URL(String(input));
 if(url.origin!==haOrigin)throw Error('unexpected target');
 if(!validToken||new Headers(init?.headers).get('Authorization')!=='Bearer synthetic-ha-token')return new Response('{}',{status:401});
 if(url.pathname==='/api/')return Response.json({message:'API running.'});
 if(url.pathname==='/api/states')return Response.json([{entity_id:'light.kitchen',state:lightState,attributes:{friendly_name:'Kitchen light',supported_color_modes:['brightness'],brightness},last_updated:'2026-10-13T10:00:00Z'},{entity_id:'switch.living_rom_light_switch_1',state:switchState,attributes:{friendly_name:'Living rom light'}},{entity_id:'sensor.plug_power',state:'17.2',attributes:{friendly_name:'Plug power'}},{entity_id:'lock.front',state:'locked',attributes:{}}]);
 if(url.pathname.startsWith('/api/services/light/')){services++;lightState=url.pathname.endsWith('turn_on')?'on':'off';if(init?.body){const body=JSON.parse(String(init.body));if(typeof body.brightness==='number')brightness=body.brightness;}return Response.json([]);}
 if(url.pathname.startsWith('/api/services/switch/')){services++;switchState=url.pathname.endsWith('turn_on')?'on':'off';return Response.json([]);}
 throw Error('unexpected route');
};
beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'redionhome-ha-'));tokenFile=path.join(root,'ha-token');writeFileSync(tokenFile,'synthetic-ha-token\n');chmodSync(tokenFile,0o600);
 for(const id of ['atelier','studio']){const dir=path.join(root,'media',id);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({kind:'panorama'}));}
 lightState='off';switchState='off';brightness=128;services=0;validToken=true;socket=new FakeSocket();
 service=createApp({root,origin,password,production:true,haAllowedOrigins:[haOrigin],haTokenFile:tokenFile,haApprovedLightId:'light.kitchen',haFetch:fakeFetch,haSocketFactory:()=>socket as unknown as WebSocket});
 const login=await post('/login',{password},'');owner=login.headers['set-cookie'][0].split(';')[0];
});
afterEach(()=>{service.ha.close();service.store.close();rmSync(root,{recursive:true,force:true});});
it('rejects arbitrary destinations, URL credentials and duplicate provider origin',async()=>{
 for(const bad of ['http://127.0.0.1:9000/','http://user:pass@127.0.0.1:8123/','http://127.0.0.1:8123/private','file:///etc/passwd'])expect(()=>validateHaOrigin(bad,[haOrigin])).toThrow();
 expect((await post('/ha/configure',{origin:haOrigin})).status).toBe(200);
 expect((await post('/ha/configure',{origin:'http://127.0.0.1:9000/'})).status).toBe(400);
});
it('keeps tokens server side and rejects wrong or expired credentials',async()=>{
 validToken=false;
 expect((await post('/ha/configure',{origin:haOrigin})).status).toBe(401);
 validToken=true;
 const configured=await post('/ha/configure',{origin:haOrigin});
 expect(configured.status).toBe(200);
 expect(JSON.stringify(configured.body)).not.toContain('synthetic-ha-token');
 await handshake();
 validToken=false;
 expect((await post('/ha/test')).status).toBe(401);
 expect((await get('/ha')).body.status).toBe('ERROR');
});
it('discovers power lights and switches, binds a hotspot once and persists the identity',async()=>{
 await post('/ha/configure',{origin:haOrigin});
 await handshake();
 const discovered=await get('/ha/discover');expect(discovered.status).toBe(200);expect(discovered.body.map((e:{entityId:string})=>e.entityId)).toEqual(['light.kitchen','switch.living_rom_light_switch_1']);
 const home=service.store.home(),objectId='light';
 const bind=await post('/ha/bind',{objectId,entityId:'light.kitchen',expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 expect(bind.status).toBe(201);
 expect(bind.body.objects.find((o:{id:string})=>o.id===objectId).actions).toContainEqual({type:'device',bindingId:service.ha.binding(objectId)?.binding_id});
 expect((await post('/ha/bind',{objectId,entityId:'light.kitchen',expectedRevision:bind.body.revision,confirmSamePhysicalDevice:true})).status).toBe(409);
 expect((await get('/devices')).body.entities.some((e:{entityId?:string})=>e.entityId==='light.kitchen')).toBe(true);
 service.ha.close();service.store.close();
 service=createApp({root,origin,password,production:true,haAllowedOrigins:[haOrigin],haTokenFile:tokenFile,haApprovedLightId:'light.kitchen',haFetch:fakeFetch,haSocketFactory:()=>socket as unknown as WebSocket});
 expect(service.ha.binding(objectId)?.entity_id).toBe('light.kitchen');
});
it('lists supported and other HA devices read-only and requires owner identity confirmation for binding',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 const inventory=await get('/ha/inventory');
 expect(inventory.status).toBe(200);
 expect(inventory.body.find((e:{entityId:string})=>e.entityId==='light.kitchen')).toMatchObject({name:'Kitchen light',state:'off',supported:true,observedAt:'2026-10-13T10:00:00Z'});
 expect(inventory.body.find((e:{entityId:string})=>e.entityId==='sensor.plug_power')).toMatchObject({name:'Plug power',rawState:'17.2',supported:true,category:'sensor',capabilities:['telemetry'],values:{value:'17.2'}});
 expect(inventory.body.find((e:{entityId:string})=>e.entityId==='lock.front')).toMatchObject({rawState:'locked',supported:true,category:'lock',capabilities:['lock'],commandCapabilities:[]});
 expect(services).toBe(0);
 const home=service.store.home();
 expect((await post('/ha/bind',{objectId:'light',entityId:'light.kitchen',expectedRevision:home.revision})).status).toBe(400);
 expect(service.ha.binding('light')).toBeUndefined();
});
it('reads a Smart Life switch through HA while physical commands remain blocked',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 const home=service.store.home();
 const bound=await post('/ha/bind',{objectId:'light',entityId:'switch.living_rom_light_switch_1',expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 expect(bound.status).toBe(201);
 const current=()=>get('/devices').then(r=>r.body.entities.find((e:{entityId?:string})=>e.entityId==='switch.living_rom_light_switch_1'));
 expect((await current()).state).toBe('off');
 switchState='on';await service.ha.refresh();
 expect((await current()).state).toBe('on');
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',id:1,event:{data:{entity_id:'switch.living_rom_light_switch_1',new_state:{entity_id:'switch.living_rom_light_switch_1',state:'off',attributes:{friendly_name:'Living rom light'}}}}})}));
 expect((await current()).state).toBe('off');
 const denied=await post('/commands',{objectId:'light',action:'turn_off',confirmEntityId:'switch.living_rom_light_switch_1'});
 expect(denied.status).toBe(403);expect(denied.body.error).toBe('HA_CONTROL_NOT_ENABLED');expect(services).toBe(0);
});
it('discovers one provider-neutral catalogue without merging names or sending commands',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 const discovered=await post('/unified-devices/discover');
 expect(discovered.status).toBe(200);expect(discovered.body.totals).toMatchObject({devices:4,online:4,controllable:2,linked:0});
 expect(discovered.body.providers).toEqual([
  {provider:'home-assistant',status:'connected',discovered:4,reason:null},
  {provider:'smartthings',status:'blocked',discovered:0,reason:'ST_AUTH_BLOCKED'},
  {provider:'tuya',status:'blocked',discovered:0,reason:'TUYA_AUTH_BLOCKED'},
 ]);
 expect(discovered.body.devices.find((device:{externalId:string})=>device.externalId==='sensor.plug_power')).toMatchObject({category:'sensor',capabilities:['telemetry'],commandCapabilities:[],objectId:null});
 expect((await get('/unified-devices')).body.devices).toHaveLength(4);expect(services).toBe(0);
});
it('enables a confirmed ordinary HA switch through the same capability boundary',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 const home=service.store.home();const added=await post('/ha/add',{entityId:'switch.living_rom_light_switch_1',expectedRevision:home.revision,sceneId:'atelier-view',position:{yaw:0.4,pitch:0},confirmSamePhysicalDevice:true,enableControl:true});
 expect(added.status).toBe(201);expect(added.body.controlEnabled).toBe(true);
 const command=await post('/commands',{objectId:added.body.objectId,action:'turn_on',confirmEntityId:'switch.living_rom_light_switch_1'});
 expect(command.status).toBe(200);expect(command.body.entities.find((entity:{entityId?:string})=>entity.entityId==='switch.living_rom_light_switch_1')).toMatchObject({state:'on',controlEnabled:true});expect(services).toBe(1);
});
it('denies guest and viewer setup/commands, requires exact confirmation and observes provider state',async()=>{
 await post('/ha/configure',{origin:haOrigin});
 await handshake();
 const home=service.store.home();const added=await post('/ha/add',{entityId:'light.kitchen',expectedRevision:home.revision,sceneId:'atelier-view',position:{yaw:0.2,pitch:0.1},name:'Kitchen light',confirmSamePhysicalDevice:true,enableControl:true});expect(added.status).toBe(201);const objectId=added.body.objectId;
 service.store.db.prepare('INSERT INTO users VALUES(?,?,?)').run('viewer',passwordHash(password),'viewer');
 const viewerLogin=await post('/login',{username:'viewer',password},'');const viewer=viewerLogin.headers['set-cookie'][0].split(';')[0];
 expect((await get('/ha',viewer)).status).toBe(403);
 expect((await get('/ha/inventory',viewer)).status).toBe(403);
 expect((await post('/ha/add',{entityId:'light.kitchen',expectedRevision:service.store.home().revision,sceneId:'atelier-view',position:{yaw:0,pitch:0},confirmSamePhysicalDevice:true,enableControl:true},viewer)).status).toBe(403);
 expect((await post('/commands',{objectId,action:'turn_on',confirmEntityId:'light.kitchen'},viewer)).status).toBe(403);
 const guestToken='synthetic-guest-session';service.store.db.prepare('INSERT INTO users VALUES(?,?,?)').run('guest','invitation-only','viewer');
 service.store.db.prepare('INSERT INTO access(user_id,role,label,grant_json,expires,max_sessions) VALUES(?,?,?,?,?,?)').run('guest','invited_guest','guest',JSON.stringify({publicationId:'example'}),Date.now()+60000,1);
 service.store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(guestToken).digest('hex'),'guest',Date.now()+60000);
 const guest=`roh_session=${guestToken}`;
 expect((await get('/devices',guest)).status).toBe(403);
 expect((await post('/ha/add',{entityId:'light.kitchen',expectedRevision:service.store.home().revision,sceneId:'atelier-view',position:{yaw:0,pitch:0},confirmSamePhysicalDevice:true,enableControl:true},guest)).status).toBe(403);
 expect((await post('/commands',{objectId,action:'turn_on',confirmEntityId:'light.kitchen'},guest)).status).toBe(403);
 expect((await post('/commands',{objectId,action:'turn_on'})).status).toBe(400);
 expect(services).toBe(0);
 lightState='unavailable';await service.ha.refresh();
 expect((await get('/devices')).body.entities.find((e:{entityId?:string})=>e.entityId==='light.kitchen').state).toBe('unavailable');
 expect((await post('/commands',{objectId,action:'turn_on',confirmEntityId:'light.kitchen'})).status).toBe(409);
 expect(services).toBe(0);lightState='off';await service.ha.refresh();
 const action=await post('/commands',{objectId,action:'turn_on',confirmEntityId:'light.kitchen'});
 expect(action.status).toBe(200);expect(action.body.entities.find((e:{entityId?:string})=>e.entityId==='light.kitchen').state).toBe('on');expect(services).toBe(1);
 const dim=await post('/commands',{objectId,action:'set_brightness',brightness:40,confirmEntityId:'light.kitchen'});expect(dim.status).toBe(200);expect(dim.body.entities.find((e:{entityId?:string})=>e.entityId==='light.kitchen').brightness).toBe(40);
 lightState='off';await service.ha.refresh();expect((await get('/devices')).body.entities.find((e:{entityId?:string})=>e.entityId==='light.kitchen').state).toBe('off');
});
it('marks bound state unavailable after a socket disconnect and resynchronizes after reconnect',async()=>{
 await post('/ha/configure',{origin:haOrigin});
 await handshake();
 const home=service.store.home();await post('/ha/bind',{objectId:'light',entityId:'light.kitchen',expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 expect(socket.sent.some(s=>JSON.parse(s).type==='auth')).toBe(true);
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',id:1,event:{data:{entity_id:'light.kitchen',new_state:{entity_id:'light.kitchen',state:'on',attributes:{}}}}})}));
 expect((await get('/devices')).body.entities.find((e:{entityId?:string})=>e.entityId==='light.kitchen').state).toBe('on');
 socket.close();expect((await get('/devices')).body.entities.find((e:{entityId?:string})=>e.entityId==='light.kitchen').state).toBe('unavailable');
 lightState='off';service.ha.connect();await handshake();
 expect((await get('/devices')).body.entities.find((e:{entityId?:string})=>e.entityId==='light.kitchen').state).toBe('off');
});
it('keeps a binding consistent through ordinary edits and requires unbind before removing its hotspot',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 const initial=service.store.home();const bound=await post('/ha/bind',{objectId:'light',entityId:'light.kitchen',expectedRevision:initial.revision,confirmSamePhysicalDevice:true});expect(bound.status).toBe(201);
 const edited=structuredClone(bound.body);edited.objects.find((o:{id:string})=>o.id==='light').provider=undefined;
 const rejected=await request(service.app).put('/api/v1/home').set('Host','127.0.0.1:4196').set('Origin',origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie',owner).send(edited);
 expect(rejected.status).toBe(409);expect(rejected.body.error).toBe('HA_BINDING_MANAGED');
 expect(service.ha.binding('light')).toBeDefined();
 const unbound=await post('/ha/unbind',{objectId:'light',expectedRevision:bound.body.revision});expect(unbound.status).toBe(200);
 expect(service.ha.binding('light')).toBeUndefined();expect(unbound.body.objects.some((o:{id:string})=>o.id==='light')).toBe(true);
});
it('never sends a physical service request without exact operator approval',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 const home=service.store.home();await post('/ha/bind',{objectId:'light',entityId:'light.kitchen',expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 service.ha.close();service.store.close();
 service=createApp({root,origin,password,production:true,haAllowedOrigins:[haOrigin],haTokenFile:tokenFile,haFetch:fakeFetch,haSocketFactory:()=>socket as unknown as WebSocket});
 await handshake();
 const denied=await post('/commands',{objectId:'light',action:'turn_on',confirmEntityId:'light.kitchen'});
 expect(denied.status).toBe(403);expect(denied.body.error).toBe('HA_CONTROL_NOT_ENABLED');expect(services).toBe(0);
});
it('rejects portal reuse and keeps the old read-only binding separate from new controls',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 const home=service.store.home();
 const bad=await post('/ha/add',{entityId:'light.kitchen',expectedRevision:home.revision,sceneId:'atelier-view',existingObjectId:'to-studio',confirmSamePhysicalDevice:true,enableControl:true});
 expect(bad.status).toBe(400);expect(bad.body.error).toBe('DEVICE_PORTAL_NOT_ALLOWED');expect(service.store.home().revision).toBe(home.revision);expect(services).toBe(0);
 const old=await post('/ha/bind',{objectId:'light',entityId:'light.kitchen',expectedRevision:home.revision,confirmSamePhysicalDevice:true});expect(old.status).toBe(201);
 expect(service.ha.binding('light')?.control_enabled).toBe(0);
 expect((await post('/commands',{objectId:'light',action:'turn_on',confirmEntityId:'light.kitchen'})).status).toBe(403);
 expect(services).toBe(0);
});
it('moves a legacy light off a doorway atomically and preserves the doorway',async()=>{
 await post('/ha/configure',{origin:haOrigin});await handshake();
 service.store.db.transaction(()=>{
  service.store.db.prepare('INSERT INTO ha_bindings(binding_id,object_id,entity_id) VALUES(?,?,?)').run('ha-legacy-door','to-studio','light.kitchen');
  service.store.db.prepare('INSERT INTO canonical_devices(id,object_id,primary_provider) VALUES(?,?,?)').run('device-legacy-door','to-studio','home-assistant');
  service.store.db.prepare('INSERT INTO provider_identities(provider,external_id,device_id,confirmed_by) VALUES(?,?,?,?)').run('home-assistant','light.kitchen','device-legacy-door','legacy');
  const home=service.store.home();service.store.save({...home,objects:home.objects.map(o=>o.id==='to-studio'?{...o,provider:{identity:o.id,active:'home-assistant' as const,status:'configured' as const},actions:[...o.actions,{type:'device' as const,bindingId:'ha-legacy-door'}]}:o)},'test');
 })();
 const before=service.store.home();
 const moved=await post('/ha/add',{entityId:'light.kitchen',expectedRevision:before.revision,sceneId:'atelier-view',position:{yaw:-0.2,pitch:0.2},name:'Kitchen light',confirmSamePhysicalDevice:true,enableControl:true,moveExisting:true});
 expect(moved.status).toBe(201);expect(moved.body.home.revision).toBe(before.revision+1);
 expect(moved.body.home.objects.find((o:{id:string})=>o.id==='to-studio').actions).toEqual([{type:'portal',sceneId:'studio-view'}]);
 expect(service.ha.binding(moved.body.objectId)?.control_enabled).toBe(1);
 expect((await post('/commands',{objectId:moved.body.objectId,action:'turn_off',confirmEntityId:'light.kitchen'})).status).toBe(200);
 expect(services).toBe(1);
});

import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync,writeFileSync,chmodSync,symlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp,passwordHash} from '../server/app.ts';
import {productConfigSchema,type ProductConnection} from '../shared/product-integrations.ts';

const origin='http://127.0.0.1:4196',password='synthetic-f3-password';
const pianoId='d6138c74-d9bb-4112-b179-0505737d32af';
let root:string,service:ReturnType<typeof createApp>,cookie:string;
let config:{version:1;connections:ProductConnection[]};
const fetcher=vi.fn<typeof fetch>();
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const req=(method:'get'|'post',url:string,body?:unknown,auth=cookie)=>{const r=request(service.app)[method]('/api/v1'+url).set('Host','127.0.0.1:4196').set('Origin',origin).set('Cookie',auth);return body===undefined?r:r.send(body as object);};
const get=(id='piano-real')=>req('get','/product-integrations/'+id);
function seed(){const h=service.store.home();h.objects.push(...[{id:'piano-real',kind:'piano' as const,adapterId:'piano-core' as const},{id:'led-real',kind:'generic' as const,adapterId:'led-wall' as const},{id:'tv-real',kind:'tv' as const,adapterId:'home-assistant' as const},{id:'bambu-real',kind:'printer' as const,adapterId:'bambu-lab' as const}].map(o=>({id:o.id,roomId:'atelier',kind:o.kind,name:o.id,description:'Synthetic fixture',actions:[{type:'integration' as const,adapterId:o.adapterId}]})));service.store.save(h,'test');}
const auditCount=(action:string)=>service.store.db.prepare('SELECT count(*) FROM audit WHERE action=?').pluck().get(action);
beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'rdh-f3-'));
 config={version:1,connections:[{objectId:'piano-real',product:'piano-core',origin:'http://piano.fixture:8788',expectedDeviceId:pianoId},{objectId:'led-real',product:'led-wall',origin:'http://led.fixture'}]};
 fetcher.mockReset();fetcher.mockImplementation(async(input,init)=>{expect(init?.method).toBe('GET');expect(init?.redirect).toBe('error');const url=new URL(String(input));
  if(url.pathname==='/api/v1/device')return json({device_id:pianoId,identity_schema:1,product:'Piano Core',private:'never return'});
  if(url.pathname==='/api/v1/health')return json({status:'degraded',application:{state:'READY'},midi_input:{connection:'DISCONNECTED'},playback:{state:'IDLE',available:false},secret:'not exposed'});
  if(url.pathname==='/identity')return json({deviceId:'',deviceType:'visual_display_v1',protocolVersion:1,fwVersion:'fixture',capabilities:['display.state.read']});
  if(url.pathname==='/state')return json({deviceId:'',available:true,brightness:{current:5,max:20},currentMode:'idle'});
  if(url.pathname==='/registry')return json({animations:['rainbow','warm']});
  throw Error('Unexpected endpoint');
 });
 service=createApp({root,origin,password,production:true,productFetch:fetcher,productConnections:config});seed();
 cookie=(await req('post','/login',{password},'')).headers['set-cookie'][0].split(';')[0];
});
afterEach(()=>{service.ha.close();service.store.close();rmSync(root,{recursive:true,force:true});vi.restoreAllMocks();});

it('keeps product origins, reports and launch endpoints owner-only',async()=>{
 expect((await req('get','/product-integrations','', '')).status).toBe(401);
 service.store.db.prepare('INSERT INTO users(id,role,password_hash) VALUES(?,?,?)').run('viewer','viewer',passwordHash('synthetic-viewer-pass'));
 const viewer=(await req('post','/login',{username:'viewer',password:'synthetic-viewer-pass'},'')).headers['set-cookie'][0].split(';')[0];
 for(const [method,url,body]of [['get','/product-integrations',undefined],['get','/product-integrations/piano-real',undefined],['post','/product-integrations/piano-real/open',{requestId:randomUUID()}]] as const)expect((await req(method,url,body,viewer)).status).toBe(403);
 expect(fetcher).not.toHaveBeenCalled();
});
it('identifies the real application separately from MIDI availability, without forwarding raw provider fields',async()=>{
 const r=await get();expect(r.status,r.text).toBe(200);expect(r.body).toMatchObject({status:'degraded',identityVerified:true,launchUrl:'http://piano.fixture:8788/',commandSupported:false,physicalResult:'NOT_VERIFIED'});
 expect(r.body.readings).toContainEqual({label:'MIDI',value:'DISCONNECTED',sourceObservedAt:null});expect(r.text).not.toContain('secret');expect(r.text).not.toContain('never return');
 expect(fetcher.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual(['/api/v1/device','/api/v1/health']);
});
it('deduplicates concurrent reads, retains the acquisition time and records unchanged state only once',async()=>{
 const [a,b]=await Promise.all([get(),get()]);expect(a.body).toEqual(b.body);expect(fetcher).toHaveBeenCalledTimes(2);expect(auditCount('integration.observed')).toBe(1);
 expect((await get()).body.receivedAt).toBe(a.body.receivedAt);expect(fetcher).toHaveBeenCalledTimes(2);
 const time=Date.now();vi.spyOn(Date,'now').mockReturnValue(time+16000);await get();expect(fetcher).toHaveBeenCalledTimes(4);expect(auditCount('integration.observed')).toBe(1);
});
it('refuses a replaced Piano Core identity before reading health or offering a launch',async()=>{
 config.connections[0].expectedDeviceId=randomUUID();const r=await get();expect(r.body).toMatchObject({status:'identity_mismatch',identityVerified:false,launchUrl:null,readings:[]});expect(fetcher).toHaveBeenCalledTimes(1);
 expect((await req('post','/product-integrations/piano-real/open',{requestId:randomUUID()})).status).toBe(409);expect(auditCount('integration.open_requested')).toBe(0);
});
it('invalidates an in-flight result if the configured destination changes',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});const original=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(...args)=>{await gate;return original(...args);});
 const pending=get().then(r=>r);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));config.connections[0].origin='http://replacement.fixture';release();expect((await pending).status).toBe(409);expect(auditCount('integration.observed')).toBe(0);
});
it('shows empty LED identity truthfully, reads only advertised state and registry, and adds no physical command route',async()=>{
 const r=await get('led-real');expect(r.body).toMatchObject({status:'identity_unverified',identityVerified:false,commandSupported:false,presets:['rainbow','warm']});expect(r.body.readings).toContainEqual({label:'Kufiri i pajisjes',value:20,unit:'%',sourceObservedAt:null});
 expect((await req('post','/product-integrations/led-real/command',{scene:'warm'})).status).toBe(404);expect(fetcher.mock.calls.every(([,init])=>init?.method==='GET')).toBe(true);
});
it('does not hide a mismatched pinned LED identity behind the configured host',async()=>{
 config.connections[1].expectedDeviceId='led-pinned';expect((await get('led-real')).body).toMatchObject({status:'identity_mismatch',launchUrl:null,readings:[]});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('records a launch request once without asserting a browser opened or a process started',async()=>{
 const requestId=randomUUID(),a=await req('post','/product-integrations/piano-real/open',{requestId}),b=await req('post','/product-integrations/piano-real/open',{requestId});
 expect(a.body).toEqual(b.body);expect(a.body).toMatchObject({result:'open_requested',processStarted:false});expect(auditCount('integration.open_requested')).toBe(1);
 expect((await req('post','/product-integrations/led-real/open',{requestId})).status).toBe(409);
 const event=JSON.parse((service.store.db.prepare("SELECT detail FROM audit WHERE action='integration.open_requested'").get() as {detail:string}).detail);expect(event).toMatchObject({objectId:'piano-real',channel:'button',processStarted:false});expect(event).not.toHaveProperty('url');
});
it('never accepts a network destination or raw command from a client request',async()=>{
 const r=await req('post','/product-integrations/piano-real/open',{requestId:randomUUID(),url:'http://127.0.0.1:1',command:'play'});expect(r.status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
});
it('rejects credentials, path/query origins, duplicate objects and duplicate physical identities',()=>{
 for(const origin of ['http://user:pass@piano.fixture','http://piano.fixture/path','http://piano.fixture?token=private','file:///etc/passwd'])expect(productConfigSchema.safeParse({version:1,connections:[{...config.connections[0],origin}]}).success).toBe(false);
 expect(productConfigSchema.safeParse({...config,connections:[config.connections[0],{...config.connections[0],objectId:'another'}]}).success).toBe(false);
});
it('rejects a private config file with unsafe permissions or a symlink',async()=>{
 service.ha.close();service.store.close();const file=path.join(root,'product-connections.json');writeFileSync(file,JSON.stringify(config),{mode:0o644});service=createApp({root,origin,production:true,productFetch:fetcher});expect((await get()).status).toBe(503);
 chmodSync(file,0o600);expect((await get()).status).toBe(200);
 rmSync(file);writeFileSync(file+'.target',JSON.stringify(config),{mode:0o600});symlinkSync(file+'.target',file);expect((await get()).status).toBe(503);
});
it('drops previous telemetry on a failed fresh read instead of inventing an online state',async()=>{
 await get();vi.spyOn(Date,'now').mockReturnValue(Date.now()+16000);fetcher.mockRejectedValue(Error('Private diagnostic must not leak'));
 const r=await get();expect(r.body).toMatchObject({status:'offline',readings:[],launchUrl:null});expect(r.text).not.toContain('Private diagnostic');
});
it('bounds response bytes even without a content-length header',async()=>{
 fetcher.mockResolvedValue(new Response(' '.repeat(65537)));expect((await get()).body).toMatchObject({status:'offline',readings:[]});
});
it('does not infer a Bambu printer or sensor grouping from a similar name',async()=>{
 expect((await get('bambu-real')).body).toMatchObject({status:'unconfigured',readings:[],commandSupported:false});expect(fetcher).not.toHaveBeenCalled();
 config.connections.push({objectId:'bambu-real',product:'bambu-lab',sensors:{status:'sensor.exact_status',progress:'sensor.exact_progress',bed:'sensor.missing'}});
 vi.spyOn(service.ha,'inventory').mockResolvedValue([
  {entity_id:'sensor.exact_status',state:'printing',attributes:{},last_updated:'2026-10-26T10:00:00Z'},
  {entity_id:'sensor.exact_progress',state:'0',attributes:{unit_of_measurement:'%'},last_updated:'2026-10-26T10:00:00Z'},
  {entity_id:'sensor.similar_bambu_nozzle',state:'200',attributes:{unit_of_measurement:'°C'}},
 ].map(e=>({entityId:e.entity_id,name:e.entity_id,domain:'sensor',source:'home-assistant' as const,state:'available' as const,rawState:e.state,availability:'online' as const,observedAt:e.last_updated??null,supported:true,category:'sensor' as const,capabilities:[],commandCapabilities:[],values:{value:e.state,...(e.attributes.unit_of_measurement?{unit_of_measurement:e.attributes.unit_of_measurement}:{})}})));
 const r=await get('bambu-real');expect(r.body.readings).toHaveLength(2);expect(r.body.readings[1]).toMatchObject({label:'Progresi',value:'0',unit:'%',sourceObservedAt:'2026-10-26T10:00:00Z'});expect(r.body.readings.map((reading:{value:string|number})=>String(reading.value))).not.toContain('200');expect(r.body.identityVerified).toBe(false);
});
it('requires a fresh matching HA binding for a TV and never enables its remote',async()=>{
 expect((await get('tv-real')).body).toMatchObject({status:'unconfigured',commandSupported:false});
 const h=service.store.home(),tv=h.objects.find(o=>o.id==='tv-real')!;tv.actions=[{type:'device',bindingId:'tv-binding'}];tv.provider={identity:tv.id,active:'home-assistant',status:'configured'};service.store.save(h,'test');
 service.store.db.prepare('INSERT INTO ha_bindings(object_id,binding_id,entity_id,control_enabled) VALUES(?,?,?,0)').run(tv.id,'tv-binding','media_player.exact_tv');
 vi.spyOn(service.ha,'snapshot').mockReturnValue([{bindingId:'tv-binding',entityId:'media_player.exact_tv',name:'TV',state:'off',source:'home-assistant',observedAt:null,category:'tv',availability:'online',statusText:'off',values:{volume_level:0.2},capabilities:['volume'],commandCapabilities:[],controlEnabled:false,brightness:null}]);
 const r=await get('tv-real');expect(r.body).toMatchObject({name:'TV',status:'online',identityVerified:false,commandSupported:false,launchUrl:null});
});
it('provides the same bounded read-only observations to AI without private URLs or raw identity',async()=>{
 const {ProductIntegrations}=await import('../server/product-integrations.ts');
 const p=new ProductIntegrations(service.store,root,service.ha,fetcher,config),context=await p.aiContext();
 expect(context).toHaveLength(2);expect(context[0]).toMatchObject({product:'piano-core',commandSupported:false});const s=JSON.stringify(context);expect(s).not.toContain('piano.fixture');expect(s).not.toContain(pianoId);expect(s).not.toContain('secret');
});

import {afterEach,beforeEach,expect,it} from 'vitest';
import {createHash,createHmac} from 'node:crypto';
import {chmodSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {createApp,passwordHash} from '../server/app.ts';
import {TuyaReadOnly,supportsTuyaSwitch} from '../server/tuya.ts';

const origin='http://127.0.0.1:4198',password='synthetic-owner-password-42';
const id='syntheticDevice001',uid='eu-test-user',clientId='syntheticClient001',secret='synthetic-secret-42';
let root:string,configFile:string,service:ReturnType<typeof createApp>,owner:string,online:boolean,power:boolean,now:number,calls:string[];
const fakeFetch:typeof fetch=async(input,init)=>{
 const url=new URL(String(input)),headers=new Headers(init?.headers),token=headers.get('access_token')??'';
 calls.push(`${init?.method}:${url.href}`);
 if(url.origin!=='https://openapi.tuyaeu.com'||init?.method!=='GET'||init?.redirect!=='error')throw Error('unexpected request');
 const t=headers.get('t'),nonce=headers.get('nonce');
 if(!t||!nonce||headers.get('client_id')!==clientId||headers.get('sign_method')!=='HMAC-SHA256')throw Error('missing signature headers');
 const bodyHash=createHash('sha256').update('').digest('hex');
 const signed=`${clientId}${token}${t}${nonce}GET\n${bodyHash}\n\n${url.pathname}${url.search}`;
 const expected=createHmac('sha256',secret).update(signed).digest('hex').toUpperCase();
 if(headers.get('sign')!==expected)throw Error('invalid signature');
 if(url.pathname==='/v1.0/token'&&url.search==='?grant_type=1'&&!token)return Response.json({success:true,result:{access_token:'synthetic-access',expire_time:7200}});
 if(token!=='synthetic-access')throw Error('missing access token');
 if(url.pathname===`/v1.0/users/${uid}/devices`&&url.search==='?page_no=1&page_size=50')return Response.json({success:true,result:[{id,name:'Test plug',online,status:[{code:'switch',value:power}],update_time:1791892800,local_key:'must-never-reach-ui',ip:'private-ip'}]});
 if(url.pathname===`/v1.0/devices/${id}`)return Response.json({success:true,result:{id,name:'Test plug',online,status:[{code:'switch',value:power}],update_time:1791892800,local_key:'must-never-reach-ui'}});
 throw Error('unexpected path');
};
const get=(route:string,cookie=owner)=>request(service.app).get(`/api/v1${route}`).set('Host','127.0.0.1:4198').set('Cookie',cookie);
const post=(route:string,body:object={},cookie=owner)=>request(service.app).post(`/api/v1${route}`).set('Host','127.0.0.1:4198').set('Origin',origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie',cookie).send(body);
beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'redionhome-tuya-'));configFile=path.join(root,'tuya.json');
 writeFileSync(configFile,JSON.stringify({region:'eu',clientId,clientSecret:secret,uid}));chmodSync(configFile,0o600);
 online=true;power=false;now=1_791_892_800_000;calls=[];
 service=createApp({root,origin,password,production:true,tuyaConfigFile:configFile,tuyaFetch:fakeFetch,tuyaNow:()=>now});
 const login=await post('/login',{password},'');owner=login.headers['set-cookie'][0].split(';')[0];
});
afterEach(()=>{service.ha.close();service.store.close();rmSync(root,{recursive:true,force:true});});

it('signs only official GET endpoints and removes provider secrets from discovery',async()=>{
 const result=await get('/tuya/discover');
 expect(result.status).toBe(200);
 expect(result.body).toEqual([{id,name:'Test plug',online:true,supportedCapabilities:['power']}]);
 expect(JSON.stringify(result.body)).not.toContain('local_key');
 expect(calls).toHaveLength(2);
 expect(calls.every(call=>call.startsWith('GET:https://openapi.tuyaeu.com/'))).toBe(true);
});

it('imports a direct Tuya device into the unified catalogue and places it read-only',async()=>{
 const report=await post('/unified-devices/discover');expect(report.status).toBe(200);
 expect(report.body.devices).toEqual([expect.objectContaining({provider:'tuya',externalId:id,name:'Test plug',category:'outlet',capabilities:['power'],commandCapabilities:[],availability:'online',objectId:null})]);
 const home=service.store.home();const added=await post('/unified-devices/add',{provider:'tuya',externalId:id,expectedRevision:home.revision,sceneId:'atelier-view',position:{yaw:0.7,pitch:0.1},confirmSamePhysicalDevice:true});
 expect(added.status).toBe(201);expect(added.body.controlEnabled).toBe(false);
 expect(added.body.home.objects.find((object:{id:string})=>object.id===added.body.objectId)).toMatchObject({kind:'outlet',provider:{active:'tuya',status:'configured'}});
 expect(calls.every(call=>call.startsWith('GET:'))).toBe(true);
});

it('requires exact owner confirmation and keeps physical commands blocked',async()=>{
 const home=service.store.home();
 expect((await post('/tuya/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:false})).status).toBe(400);
 expect((await post('/tuya/bind',{objectId:'missing',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true})).status).toBe(400);
 const bound=await post('/tuya/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 expect(bound.status).toBe(201);
 expect((await get('/device-registry')).body).toEqual([expect.objectContaining({objectId:'light',provider:'tuya',externalId:id,confirmedBy:'owner'})]);
 expect((await post('/commands',{objectId:'light',action:'turn_on'})).body.error).toBe('REAL_COMMANDS_PHASE_2_LOCKED');
 expect(calls.every(call=>call.startsWith('GET:'))).toBe(true);
});

it('reads external changes after the cache window and hides offline state',async()=>{
 const home=service.store.home();await post('/tuya/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 const current=()=>get('/devices').then(r=>r.body.entities.find((e:{source:string})=>e.source==='tuya'));
 expect((await current()).state).toBe('off');
 power=true;
 expect((await current()).state).toBe('off');
 now+=10_001;
 expect((await current()).state).toBe('on');
 online=false;now+=10_001;
 expect((await current()).state).toBe('unavailable');
});

it('keeps guest paths closed and safely removes only the Tuya identity',async()=>{
 const home=service.store.home();const bound=await post('/tuya/bind',{objectId:'light',deviceId:id,expectedRevision:home.revision,confirmSamePhysicalDevice:true});
 service.store.db.prepare('INSERT INTO users VALUES(?,?,?)').run('viewer',passwordHash(password),'viewer');
 const login=await post('/login',{username:'viewer',password},'');const viewer=login.headers['set-cookie'][0].split(';')[0];
 expect((await get('/tuya/discover',viewer)).status).toBe(403);
 expect((await get('/tuya/discover','')).status).toBe(401);
 expect((await post('/tuya/unbind',{objectId:'light',expectedRevision:bound.body.revision},viewer)).status).toBe(403);
 const unbound=await post('/tuya/unbind',{objectId:'light',expectedRevision:bound.body.revision});
 expect(unbound.status).toBe(200);
 expect(unbound.body.objects.find((o:{id:string})=>o.id==='light').mediaId).toBe(home.objects.find(o=>o.id==='light')?.mediaId);
 expect((await get('/device-registry')).body).toHaveLength(0);
});

it('rejects public config permissions and ambiguous multi-channel switches',async()=>{
 await expect(new TuyaReadOnly('relative/tuya.json',fakeFetch).discover()).rejects.toThrow('TUYA_CONFIG_UNSAFE');
 chmodSync(configFile,0o644);
 await expect(new TuyaReadOnly(configFile,fakeFetch).discover()).rejects.toThrow('TUYA_CONFIG_UNSAFE');
 chmodSync(configFile,0o600);
 const ambiguous:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname==='/v1.0/token')return Response.json({success:true,result:{access_token:'synthetic-access',expire_time:7200}});
  if(url.pathname===`/v1.0/users/${uid}/devices`)return Response.json({success:true,result:[{id,name:'Multi switch',online:true,status:[{code:'switch_1',value:true},{code:'switch_2',value:false}]}]});
  throw Error(`unexpected ${init?.method}`);
 };
 const discovered=await new TuyaReadOnly(configFile,ambiguous).discover();
 expect(discovered).toHaveLength(1);
 expect(supportsTuyaSwitch(discovered[0])).toBe(false);
});

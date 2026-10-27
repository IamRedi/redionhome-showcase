import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createApp,passwordHash} from '../server/app.ts';
import type {AIProvider} from '../server/ai.ts';
import type {DeviceAdapter} from '../server/adapters.ts';
import type {DeviceSnapshot} from '../shared/model.ts';
import type {AIProviderResult} from '../shared/ai.ts';
import {Actions} from '../server/actions.ts';

const origin='http://127.0.0.1:4199',password='disposable-f2-password-42';
let root:string,service:ReturnType<typeof createApp>,cookie:string,session:string;
let values:Record<string,'on'|'off'|'unavailable'>,calls:string[],gate:(()=>Promise<void>)|undefined;
const respond=vi.fn<AIProvider['respond']>();
const provider:AIProvider={id:'synthetic-f2',label:'Synthetic F2',destination:'in-process fixture',model:'synthetic',respond};
const proposal=(ids=['light'],resolution:'exact'|'ambiguous'='exact'):AIProviderResult=>({reply:'Propozim prove, jo pretendim ekzekutimi.',navigation:{type:'none',targetId:null},commands:ids.map(objectId=>({objectId,action:'turn_on',brightness:null,reason:'Kërkesë e qartë prove'})),inventory:[],limitations:[],targetResolution:resolution,ambient:null});
const adapter:DeviceAdapter={async snapshot(){return {mode:'mock',connection:'online',entities:Object.entries(values).map(([bindingId,state])=>({bindingId,state,name:bindingId,source:'mock',capabilities:['power']}))};},async command(binding,action){calls.push(binding);if(gate)await gate();values[binding]=action==='turn_off'?'off':'on';}};
const req=(method:'get'|'post'|'put'|'patch',url:string,body?:unknown,auth=cookie)=>{const r=request(service.app)[method](`/api/v1${url}`).set('Host','127.0.0.1:4199').set('Origin',origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie',auth);return body===undefined?r:r.send(body as object);};
const login=async()=>{const res=await req('post','/login',{password},'');return res.headers['set-cookie'][0].split(';')[0] as string;};
async function policy(mode='auto',ids=['light','light-b','light-c'],duration='persistent'){
 const version=(await req('get','/action-policy')).body.version;
 const response=await req('put','/action-policy',{expectedVersion:version,mode,duration,grants:mode==='advise'?[]:ids.map(objectId=>({objectId,actions:['turn_on','turn_off'],maxBrightness:100}))});expect(response.status,response.text).toBe(200);return response.body;
}
const chat=(requestId=randomUUID())=>req('post','/ai/chat',{message:'Ndiz dritën e saktë',requestId});
async function ambient(ids=['light','light-b','light-c'],failureMode='continue'){
 const response=await req('post','/ambients',{name:'Ambient prove',roomId:'atelier',steps:ids.map(objectId=>({objectId,action:'turn_on'})),failureMode});expect(response.status,response.text).toBe(200);return response.body;
}
function defer(){let release!:()=>void;const promise=new Promise<void>(r=>{release=r;});return {promise,release};}

beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'rdh-f2-'));values={'demo-light':'off','demo-b':'off','demo-c':'off'};calls=[];gate=undefined;respond.mockReset();respond.mockResolvedValue(proposal());
 service=createApp({root,origin,password,production:true,adapter,aiProvider:provider,aiTimeoutMs:100,actionTimeoutMs:80});
 const home=service.store.home();home.objects.push(...['b','c'].map(id=>({id:`light-${id}`,roomId:'atelier',name:`Drita ${id}`,kind:'light' as const,description:'Synthetic',actions:[{type:'device' as const,bindingId:`demo-${id}`}]})));home.scenes[0].hotspots.push(...['b','c'].map(id=>({id:`pin-${id}`,objectId:`light-${id}`,position:{yaw:0,pitch:0}})));service.store.save(home,'test');
 cookie=await login();session=createHash('sha256').update(cookie.slice('roh_session='.length)).digest('hex');
});
afterEach(()=>{gate=undefined;service.ha.close();service.store.close();rmSync(root,{recursive:true,force:true});});

it('defaults to advice and cannot execute an AI proposal by forging confirmation',async()=>{
 const result=await chat();expect(result.status).toBe(200);expect(result.body.execution.status).toBe('blocked');expect(calls).toEqual([]);
 expect((await req('post',`/action-runs/${result.body.execution.id}/execute`,{confirmed:true})).body.status).toBe('blocked');expect(calls).toEqual([]);
});
it('an old F1 tab cannot send an AI confirmation through the manual endpoint',async()=>{
 const result=await request(service.app).post('/api/v1/commands').set('Host','127.0.0.1:4199').set('Origin',origin).set('Cookie',cookie).send({objectId:'light',action:'turn_on'});expect(result.status).toBe(426);expect(result.body.error).toBe('ACTION_CLIENT_UPDATE_REQUIRED');expect(calls).toEqual([]);
});
it('requires one explicit confirmation, deduplicates concurrent execution and records one confirmed step',async()=>{
 await policy('confirm',['light']);const result=await chat(),id=result.body.execution.id;expect(result.body.execution.status).toBe('awaiting_confirmation');expect(calls).toEqual([]);
 const [a,b]=await Promise.all([req('post',`/action-runs/${id}/execute`,{confirmed:true}),req('post',`/action-runs/${id}/execute`,{confirmed:true})]);expect(a.body.status).toBe('succeeded');expect(b.body.status).toBe('succeeded');expect(calls).toEqual(['demo-light']);
 const events=(await req('get',`/action-runs/${id}/events`)).body;expect(events.filter((e:{phase:string})=>e.phase==='confirmed')).toHaveLength(1);expect(events[0]).toMatchObject({actor:'owner',executor:'ai',channel:'text',policy_version:1});
});
it('automatically executes only within the saved scope and reuses a completed AI request without another model call',async()=>{
 await policy('auto',['light']);const id=randomUUID(),a=await chat(id),b=await chat(id);expect(a.body.execution.status).toBe('succeeded');expect(b.body.execution.id).toBe(a.body.execution.id);expect(calls).toEqual(['demo-light']);expect(respond).toHaveBeenCalledTimes(1);
 expect((await req('post','/ai/chat',{message:'Ndryshim payload',requestId:id})).status).toBe(409);
});
it('deduplicates manual buttons through the same ledger without changing their existing permission mode',async()=>{
 const requestId=randomUUID();const a=await req('post','/commands',{objectId:'light',action:'turn_on',requestId}),b=await req('post','/commands',{objectId:'light',action:'turn_on',requestId});expect(a.status,a.text).toBe(200);expect(b.status).toBe(200);expect(calls).toEqual(['demo-light']);
 expect((await req('get','/action-runs')).body[0]).toMatchObject({source:'manual',status:'succeeded'});
 expect((await req('post','/commands',{objectId:'light',action:'turn_off',requestId})).status).toBe(409);
});
it('revocation invalidates an already prepared proposal',async()=>{
 await policy('confirm',['light']);const result=await chat();await policy('advise');const run=(await req('post',`/action-runs/${result.body.execution.id}/execute`,{confirmed:true})).body;expect(run.steps[0].error).toBe('ACTION_PERMISSION_CHANGED');expect(calls).toEqual([]);
});
it('does not execute outside scope or with an ambiguous target',async()=>{
 await policy('auto',['light']);respond.mockResolvedValueOnce(proposal(['light-b']));const denied=await chat();expect(denied.body.execution.steps[0].error).toBe('ACTION_SCOPE_DENIED');expect(calls).toEqual([]);
 respond.mockResolvedValueOnce(proposal(['light'],'ambiguous'));const ambiguous=await chat();expect(ambiguous.body.execution).toBeUndefined();expect(ambiguous.body.commands).toEqual([]);expect(calls).toEqual([]);
});
it('binding identity epochs invalidate grants even if the same apparent binding is restored',async()=>{
 await policy('confirm',['light']);const result=await chat();service.store.db.prepare('INSERT INTO canonical_devices(id,object_id,primary_provider) VALUES(?,?,?)').run('temp','light','mock');service.store.db.prepare('DELETE FROM canonical_devices WHERE id=?').run('temp');
 expect(service.store.db.prepare('SELECT generation FROM action_identity_epochs WHERE object_id=?').pluck().get('light')).toBe(2);
 const run=(await req('post',`/action-runs/${result.body.execution.id}/execute`,{confirmed:true})).body;expect(run.steps[0].error).toBe('ACTION_IDENTITY_CHANGED');expect(calls).toEqual([]);
 const next=await chat();expect((await req('post',`/action-runs/${next.body.execution.id}/execute`,{confirmed:true})).body.steps[0].error).toBe('ACTION_SCOPE_DENIED');
});
it('reports partial results, continues only when requested and runs stored steps without AI regeneration',async()=>{
 await policy();const a=await ambient();values['demo-b']='unavailable';const run=await req('post',`/ambients/${a.id}/run`,{requestId:randomUUID(),expectedVersion:1});expect(run.body.status,run.text).toBe('partial');expect(run.body.steps.map((s:{status:string})=>s.status)).toEqual(['confirmed','failed','confirmed']);expect(calls).toEqual(['demo-light','demo-c']);expect(respond).not.toHaveBeenCalled();
 values['demo-b']='off';calls=[];const repeat=await req('post',`/ambients/${a.id}/run`,{requestId:randomUUID(),expectedVersion:1});expect(repeat.body.status).toBe('succeeded');expect(calls).toEqual(['demo-light','demo-b','demo-c']);expect(respond).not.toHaveBeenCalled();
});
it('Stop completes an already dispatched step and prevents the next step',async()=>{
 await policy();respond.mockResolvedValue(proposal(['light','light-b']));const deferred=defer();gate=()=>deferred.promise;const id=randomUUID(),pending=chat(id).then(r=>r);
 await vi.waitFor(()=>expect(calls).toHaveLength(1));expect((await req('post','/ai/stop',{requestId:id})).status).toBe(200);deferred.release();const result=await pending;expect(result.body.execution.status,result.text).toBe('stopped');expect(result.body.execution.steps.map((s:{status:string})=>s.status)).toEqual(['confirmed','skipped']);expect(calls).toEqual(['demo-light']);
});
it('revocation during dispatch stops subsequent steps without claiming to undo the first',async()=>{
 await policy();respond.mockResolvedValue(proposal(['light','light-b']));const deferred=defer();gate=()=>deferred.promise;const pending=chat().then(r=>r);await vi.waitFor(()=>expect(calls).toHaveLength(1));await policy('advise');deferred.release();const result=await pending;expect(result.body.execution.status,result.text).toBe('partial');expect(calls).toEqual(['demo-light']);
});
it('timeout remains uncertain, skips the next step and quarantines an unresolved dispatch',async()=>{
 await policy();respond.mockResolvedValue(proposal(['light','light-b']));const deferred=defer();gate=()=>deferred.promise;
 const result=await chat();expect(result.body.execution.status,result.text).toBe('uncertain');expect(result.body.execution.steps[1].status).toBe('skipped');
 const retry=await req('post','/commands',{objectId:'light',action:'turn_on',requestId:randomUUID()});expect(retry.status).toBe(409);expect(retry.body.error).toBe('ACTION_DEVICE_BUSY');expect(calls).toEqual(['demo-light']);deferred.release();await vi.waitFor(()=>expect(values['demo-light']).toBe('on'));
});
it('expired proposals never dispatch and session-scoped permissions end with their session',async()=>{
 await policy('confirm',['light'],'session');const result=await chat();service.store.db.prepare('UPDATE action_runs SET expires_at=0 WHERE id=?').run(result.body.execution.id);
 expect((await req('post',`/action-runs/${result.body.execution.id}/execute`,{confirmed:true})).body.status).toBe('expired');expect(calls).toEqual([]);
 await req('post','/logout');cookie=await login();expect((await req('get','/action-policy')).body).toMatchObject({mode:'advise',active:false});expect((await req('post',`/action-runs/${result.body.execution.id}/execute`,{confirmed:true})).status).toBe(401);
});
it('manual capture uses fresh readback and favorite changes preserve pinned identities and history',async()=>{
 values['demo-light']='on';const saved=await req('post','/ambients/capture',{name:'Gjendja aktuale',roomId:'atelier',objectIds:['light']});expect(saved.body.steps[0].command.action).toBe('turn_on');values['demo-light']='off';
 const changed=await req('patch',`/ambients/${saved.body.id}`,{expectedVersion:1,favorite:true});expect(changed.body.steps).toEqual(saved.body.steps);expect(changed.body.version).toBe(2);expect(service.store.db.prepare('SELECT count(*) FROM ambients WHERE id=?').pluck().get(saved.body.id)).toBe(2);
 expect((await req('patch',`/ambients/${saved.body.id}`,{expectedVersion:1,favorite:false})).status).toBe(409);expect(calls).toEqual([]);
});
it('restart marks in-flight work interrupted and never automatically replays it',async()=>{
 await policy('confirm',['light']);const result=await chat(),id=result.body.execution.id;
 const step=result.body.execution.steps[0];step.status='dispatching';service.store.db.prepare("UPDATE action_runs SET status='running' WHERE id=?").run(id);service.store.db.prepare('UPDATE action_steps SET document=? WHERE run_id=?').run(JSON.stringify(step),id);
 service.store.close();service=createApp({root,origin,password,production:true,adapter,aiProvider:provider});expect(service.actions.get(id).status).toBe('interrupted');expect(service.actions.get(id).steps[0].status).toBe('uncertain');expect(calls).toEqual([]);expect(service.actions.policy('owner',session).mode).toBe('confirm');
});
it('Stop before request arrival prevents a model call and physical work',async()=>{
 const id=randomUUID();await req('post','/ai/stop',{requestId:id});const result=await chat(id);expect(result.body.error).toBe('AI_STOPPED');expect(respond).not.toHaveBeenCalled();expect(calls).toEqual([]);
});
it('a late planner result after timeout cannot execute and request IDs are not silently reused',async()=>{
 await policy();const deferred=defer();respond.mockImplementationOnce(async()=>{await deferred.promise;return proposal();});const id=randomUUID(),result=await chat(id);expect(result.body.error).toBe('AI_TIMEOUT');deferred.release();await Promise.resolve();expect(calls).toEqual([]);expect((await chat(id)).status).toBe(409);expect(respond).toHaveBeenCalledTimes(1);
});
it('limits daily model calls durably while manual controls remain independent',async()=>{
 const insert=service.store.db.prepare("INSERT INTO ai_requests(actor,request_id,request_hash,session_hash,status,created_at) VALUES('owner',?,?,?,'completed',?)");for(let i=0;i<60;i++)insert.run(randomUUID(),'test',session,new Date().toISOString());expect((await chat()).body.error).toBe('AI_DAILY_LIMIT');expect(respond).not.toHaveBeenCalled();expect((await req('post','/commands',{objectId:'light',action:'turn_on'})).status).toBe(200);
});
it('records provider usage without treating usage fields as model instructions',async()=>{
 respond.mockResolvedValueOnce({...proposal(),usage:{inputTokens:120,outputTokens:45}});const id=randomUUID(),result=await chat(id);expect(result.status,result.text).toBe(200);expect(JSON.parse(service.store.db.prepare('SELECT usage_json FROM ai_requests WHERE request_id=?').pluck().get(id) as string)).toEqual({inputTokens:120,outputTokens:45});expect(calls).toEqual([]);
});
it('saving the last AI result never repeats its actions, and running a named ambient uses stored commands',async()=>{
 await policy('auto',['light']);const first=await chat();expect(calls).toEqual(['demo-light']);
 respond.mockResolvedValueOnce({...proposal(['light-b']),ambient:{operation:'save',id:null,name:'Mbrëmje filmi',roomId:'atelier'}});
 const savedProposal=await req('post','/ai/chat',{message:'Ruaje si Mbrëmje filmi',requestId:randomUUID(),referenceRunId:first.body.execution.id});expect(savedProposal.body.execution.id).toBe(first.body.execution.id);expect(calls).toEqual(['demo-light']);
 const saved=await req('post','/ambients',{name:'Mbrëmje filmi',roomId:'atelier',runId:savedProposal.body.execution.id});
 respond.mockResolvedValueOnce({...proposal(['light-b']),ambient:{operation:'run',id:saved.body.id,name:null,roomId:null}});
 const run=await chat();expect(run.body.execution.ambientId).toBe(saved.body.id);expect(run.body.execution.steps[0].command.objectId).toBe('light');expect(calls).toEqual(['demo-light','demo-light']);
});
it('Stop before an ambient request arrives prevents every step',async()=>{
 await policy();const a=await ambient(),id=randomUUID();await req('post','/actions/stop-request',{requestId:id});const run=await req('post',`/ambients/${a.id}/run`,{requestId:id,expectedVersion:1});expect(run.body.status).toBe('stopped');expect(run.body.steps.every((s:{status:string})=>s.status==='skipped')).toBe(true);expect(calls).toEqual([]);
});
it('saving a fresh AI proposal in automatic mode requires an explicit save and does not activate it',async()=>{
 await policy();respond.mockResolvedValueOnce({...proposal(),ambient:{operation:'save',id:null,name:'Vetëm ruajtje',roomId:'atelier'}});const result=await chat();expect(result.body.execution.status).toBe('awaiting_confirmation');expect(calls).toEqual([]);expect((await req('get','/ambients')).body).toEqual([]);
});
it('a transport failure after dispatch is uncertain and never continues blindly',async()=>{
 await policy();respond.mockResolvedValueOnce(proposal(['light','light-b']));gate=async()=>{throw Error('HA_UNAVAILABLE');};const result=await chat();expect(result.body.execution.status).toBe('uncertain');expect(result.body.execution.steps[1].status).toBe('skipped');expect(calls).toEqual(['demo-light']);
});
it('edited ambients keep prior versions and stale version requests do not execute',async()=>{
 await policy();const a=await ambient(['light']);const edited=await req('post','/ambients',{id:a.id,expectedVersion:1,name:a.name,roomId:'atelier',steps:[{objectId:'light',action:'turn_off'}]});expect(edited.body.version).toBe(2);
 const old=JSON.parse(service.store.db.prepare('SELECT document FROM ambients WHERE id=? AND version=1').pluck().get(a.id) as string);expect(old.steps[0].command.action).toBe('turn_on');
 expect((await req('post',`/ambients/${a.id}/run`,{requestId:randomUUID(),expectedVersion:1})).status).toBe(409);expect(calls).toEqual([]);expect((await req('post',`/ambients/${a.id}/run`,{requestId:randomUUID(),expectedVersion:2})).body.status).toBe('succeeded');expect(values['demo-light']).toBe('off');
});
it('a session that expires during a fresh read cannot dispatch afterward',async()=>{
 await policy('auto',['light']);let valid=true,block=false;const deferred=defer();const snap=async()=>{if(block)await deferred.promise;return adapter.snapshot();};const dispatch=vi.fn(async()=>adapter.snapshot());const executor=new Actions(service.store,snap,dispatch,()=>valid);
 const prepared=await executor.prepare({id:'owner',role:'owner'},session,{requestId:randomUUID(),source:'ai',channel:'text',steps:[{objectId:'light',action:'turn_on'}]});block=true;const pending=executor.execute(prepared.id,{id:'owner',role:'owner'},session);valid=false;deferred.release();expect((await pending).steps[0].error).toBe('AUTH_REQUIRED');expect(dispatch).not.toHaveBeenCalled();
});
it('protects every new private surface and rejects model attempts to grant permissions',async()=>{
 for(const endpoint of ['/action-policy','/action-targets','/action-runs','/ambients'])expect((await req('get',endpoint,undefined,'')).status).toBe(401);
 service.store.db.prepare('INSERT INTO users VALUES(?,?,?)').run('viewer',passwordHash(password),'viewer');const viewer=(await req('post','/login',{username:'viewer',password},'')).headers['set-cookie'][0].split(';')[0];for(const endpoint of ['/action-policy','/action-targets','/action-runs','/ambients'])expect((await req('get',endpoint,undefined,viewer)).status).toBe(403);
 respond.mockResolvedValueOnce({...proposal(),permissions:{mode:'auto'}} as unknown as AIProviderResult);expect((await chat()).status).toBe(422);expect(calls).toEqual([]);
});
it('enforces exact brightness bounds through the executor before dispatch',async()=>{
 const home=service.store.home(),light=home.objects.find(o=>o.id==='light')!;light.provider={identity:'light',active:'home-assistant',status:'configured'};light.actions=[{type:'device',bindingId:'ha-synthetic'}];service.store.save(home,'test');service.store.db.prepare('INSERT INTO ha_bindings(binding_id,object_id,entity_id,control_enabled) VALUES(?,?,?,1)').run('ha-synthetic','light','light.synthetic');
 let brightness=90;const snapshot=async():Promise<DeviceSnapshot>=>({mode:'mock',connection:'online',entities:[{bindingId:'ha-synthetic',entityId:'light.synthetic',name:'Synthetic',state:'on',source:'home-assistant',availability:'online',controlEnabled:true,commandCapabilities:['power','brightness'],brightness}]});
 const send=vi.fn(async(_actor,command)=>{brightness=command.brightness??brightness;return snapshot();});const executor=new Actions(service.store,snapshot,send,()=>true);
 await executor.setPolicy('owner',session,{expectedVersion:0,mode:'auto',duration:'persistent',grants:[{objectId:'light',actions:['turn_on','set_brightness'],maxBrightness:60}]});
 for(const command of [{objectId:'light',action:'turn_on' as const},{objectId:'light',action:'set_brightness' as const,brightness:70}]){const run=await executor.prepare({id:'owner',role:'owner'},session,{requestId:randomUUID(),source:'ai',channel:'text',steps:[command]});expect((await executor.execute(run.id,{id:'owner',role:'owner'},session)).status).toBe('failed');}expect(send).not.toHaveBeenCalled();
 const run=await executor.prepare({id:'owner',role:'owner'},session,{requestId:randomUUID(),source:'ai',channel:'text',steps:[{objectId:'light',action:'set_brightness',brightness:50}]});expect((await executor.execute(run.id,{id:'owner',role:'owner'},session)).status).toBe('succeeded');expect(send).toHaveBeenCalledTimes(1);
});

import {createHash,randomUUID} from 'node:crypto';
import type {Express,RequestHandler} from 'express';
import {z} from 'zod';
import {actionSchema,actionsSchema,ambientInputSchema,policyInputSchema,requestIdSchema,type HomeAction,type ActionGrant,type ActionPolicy,type ActionTarget,type ActionStep,type ActionRun,type Ambient,type RunStatus} from '../shared/actions.ts';
import type {DeviceSnapshot} from '../shared/model.ts';
import type {Store} from './store.ts';
import type {Identity} from './tours.ts';
import {ActionError} from './commands.ts';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const now=()=>new Date().toISOString();
const fail=(code:string,status=409):never=>{throw new ActionError(status,code);};
const terminal=(status:RunStatus)=>!['running','awaiting_confirmation'].includes(status);
type Row={id:string;actor:string;request_id:string;request_hash:string;session_hash:string;source:ActionRun['source'];channel:ActionRun['channel'];status:RunStatus;policy_version:number;ambient_id:string|null;ambient_version:number|null;failure_mode:'stop'|'continue';expires_at:number;stop_requested:number;created_at:string;ended_at:string|null};
type PolicyRow={version:number;mode:ActionPolicy['mode'];duration:ActionPolicy['duration'];session_hash:string|null;grants_json:string};
type RunInput={requestId:string;source:ActionRun['source'];channel:ActionRun['channel'];steps:HomeAction[];failureMode?:'stop'|'continue';ambient?:Ambient;pins?:string[]};

export class Actions{
  private readonly running=new Map<string,Promise<ActionRun>>();
  private readonly devicesBusy=new Set<string>();
  constructor(private store:Store,private snapshot:(fresh?:boolean)=>Promise<DeviceSnapshot>,private dispatch:(actor:Identity,command:HomeAction,accepted:()=>void)=>Promise<DeviceSnapshot>,private sessionValid:(session:string,actor:string)=>boolean,private timeoutMs=20000){
    // A restart never replays physical work. An interrupted dispatch is uncertain.
    const rows=store.db.prepare("SELECT id FROM action_runs WHERE status='running'").all() as {id:string}[];
    for(const row of rows){
      for(const step of this.get(row.id).steps){if(step.status==='dispatching'){step.status='uncertain';step.error='ACTION_RESTARTED';}else if(step.status==='pending'){step.status='skipped';step.error='ACTION_RESTARTED';}this.saveStep(row.id,step);}
      this.finish(row.id,'interrupted');this.event(row.id,null,'interrupted',{code:'ACTION_RESTARTED'});
    }
    store.db.prepare("UPDATE ai_requests SET status='interrupted' WHERE status='planning'").run();
  }
  private row(id:string){return this.store.db.prepare('SELECT * FROM action_runs WHERE id=?').get(id) as Row|undefined;}
  get(id:string,actor?:string):ActionRun{
    const r=this.row(id);if(!r||actor&&r.actor!==actor)return fail('ACTION_NOT_FOUND',404);
    const steps=(this.store.db.prepare('SELECT document FROM action_steps WHERE run_id=? ORDER BY step_index').all(id) as {document:string}[]).map(r=>JSON.parse(r.document) as ActionStep);
    return {id:r.id,requestId:r.request_id,actor:r.actor,source:r.source,channel:r.channel,status:r.status,policyVersion:r.policy_version,ambientId:r.ambient_id,ambientVersion:r.ambient_version,failureMode:r.failure_mode,expiresAt:r.expires_at,stopRequested:!!r.stop_requested,createdAt:r.created_at,endedAt:r.ended_at,steps};
  }
  private saveStep(id:string,step:ActionStep){this.store.db.prepare('UPDATE action_steps SET document=? WHERE run_id=? AND step_index=?').run(JSON.stringify(step),id,step.index);}
  private finish(id:string,status:RunStatus){this.store.db.prepare('UPDATE action_runs SET status=?,ended_at=? WHERE id=?').run(status,now(),id);}
  private event(id:string,step:ActionStep|null,phase:string,detail:unknown={}){
    const run=this.row(id)!;
    this.store.db.prepare('INSERT INTO action_events(run_id,step_index,actor,executor,channel,provider,object_id,room_id,phase,policy_version,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,step?.index??null,run.actor,run.source,run.channel,step?.provider??null,step?.command.objectId??null,step?.roomId??null,phase,run.policy_version,JSON.stringify(detail),now());
  }
  policy(actor:string,session:string):ActionPolicy{
    const row=this.store.db.prepare('SELECT * FROM action_policies WHERE actor=?').get(actor) as PolicyRow|undefined;
    if(!row)return {version:0,mode:'advise',duration:'persistent',grants:[],active:true};
    const active=row.duration==='persistent'||row.session_hash===session&&this.sessionValid(session,actor);
    return {version:row.version,mode:active?row.mode:'advise',duration:row.duration,grants:active?JSON.parse(row.grants_json):[],active};
  }
  private target(objectId:string,snapshot:DeviceSnapshot,pilot=true):ActionTarget{
    const home=this.store.home(),object=home.objects.find(o=>o.id===objectId),binding=object?.actions.find(a=>a.type==='device');
    if(!object||!binding||binding.type!=='device')return fail('UNKNOWN_BINDING',403);
    const state=snapshot.entities.find(e=>e.bindingId===binding.bindingId);
    const real=this.store.db.prepare('SELECT * FROM ha_bindings WHERE object_id=?').get(objectId) as {binding_id:string;entity_id:string;control_enabled:number}|undefined;
    const mock=!real&&(!object.provider||object.provider.active==='mock')&&state?.source==='mock'&&snapshot.mode==='mock';
    if(pilot&&(object.parentId||object.actions.some(a=>a.type==='portal')||!home.scenes.some(s=>s.hotspots.some(h=>h.objectId===objectId))||!(mock&&object.kind==='light'||real&&real.entity_id.startsWith('light.')&&object.provider?.active==='home-assistant'&&binding.bindingId===real.binding_id)))return fail('ACTION_LIGHT_PILOT_ONLY',403);
    const canonical=this.store.db.prepare('SELECT * FROM canonical_devices WHERE object_id=?').get(objectId);
    const epoch=this.store.db.prepare('SELECT generation FROM action_identity_epochs WHERE object_id=?').pluck().get(objectId)??0;
    const origin=this.store.db.prepare('SELECT origin FROM ha_connection WHERE id=1').pluck().get()??null;
    const identity=hash({home:home.id,objectId,binding:binding.bindingId,provider:object.provider?.active??'mock',real:real??null,canonical:canonical??null,origin:real?origin:null,epoch});
    const permitted=!!real&&real.control_enabled===1&&state?.source==='home-assistant'&&state.entityId===real.entity_id&&state.controlEnabled===true&&state.commandCapabilities?.includes('power');
    const actions:HomeAction['action'][]=mock||permitted?['turn_on','turn_off']:[];
    if(permitted&&state?.commandCapabilities?.includes('brightness'))actions.push('set_brightness');
    return {objectId,name:object.name,roomId:object.roomId,identity,provider:real?'home-assistant':state?.source??object.provider?.active??'unknown',entityId:real?.entity_id,actions,available:mock?snapshot.connection==='online'&&!!state&&state.state!=='unavailable':!!permitted&&state?.availability==='online',brightness:state?.brightness??null,state:state?.state??'unavailable',sourceObservedAt:state?.observedAt??null};
  }
  async targets(){const snapshot=await this.snapshot(true);return this.store.home().objects.flatMap(o=>{try{return [this.target(o.id,snapshot)];}catch{return [];}});}
  async setPolicy(actor:string,session:string,body:unknown){
    const input=policyInputSchema.parse(body),snapshot=await this.snapshot(true);
    const grants:ActionGrant[]=input.grants.map(grant=>{const target=this.target(grant.objectId,snapshot);if(grant.actions.some(a=>!target.actions.includes(a)))fail('ACTION_CAPABILITY_UNSUPPORTED',403);return {...grant,identity:target.identity};});
    if(new Set(grants.map(g=>g.objectId)).size!==grants.length)fail('ACTION_DUPLICATE_SCOPE',400);
    this.store.db.transaction(()=>{
      if(this.policy(actor,session).version!==input.expectedVersion)fail('REVISION_CONFLICT');
      this.store.db.prepare('INSERT INTO action_policies VALUES(?,?,?,?,?,?,?) ON CONFLICT(actor) DO UPDATE SET version=excluded.version,mode=excluded.mode,duration=excluded.duration,session_hash=excluded.session_hash,grants_json=excluded.grants_json,updated_at=excluded.updated_at').run(actor,input.expectedVersion+1,input.mode,input.duration,input.duration==='session'?session:null,JSON.stringify(grants),now());
      this.store.audit(actor,'action.policy.changed',String(input.expectedVersion+1));
    })();
    return this.policy(actor,session);
  }
  private allowed(run:ActionRun,session:string,target:ActionTarget,command:HomeAction){
    const policy=this.policy(run.actor,session);
    if(policy.version!==run.policyVersion)return fail('ACTION_PERMISSION_CHANGED',403);
    if(policy.mode==='advise')return fail('ACTION_ADVICE_ONLY',403);
    const grant=policy.grants.find(g=>g.objectId===target.objectId&&g.identity===target.identity);
    if(!grant||!grant.actions.includes(command.action)||command.action==='set_brightness'&&command.brightness!>grant.maxBrightness)return fail('ACTION_SCOPE_DENIED',403);
    if(target.available&&!target.actions.includes(command.action))return fail('ACTION_CAPABILITY_UNSUPPORTED',403);
    if(command.action==='turn_on'&&grant.maxBrightness<100&&(target.brightness===null||target.brightness>grant.maxBrightness))return fail('ACTION_BRIGHTNESS_LIMIT',403);
  }
  async prepare(actor:Identity,session:string,input:RunInput):Promise<ActionRun>{
    const steps=actionsSchema.parse(input.steps),requestHash=hash({...input,steps});
    const old=this.store.db.prepare('SELECT id,request_hash FROM action_runs WHERE actor=? AND request_id=?').get(actor.id,input.requestId) as {id:string;request_hash:string}|undefined;
    if(old){if(old.request_hash!==requestHash)fail('ACTION_IDEMPOTENCY_CONFLICT');return this.get(old.id,actor.id);}
    const snapshot=await this.snapshot(input.source!=='manual'),policy=this.policy(actor.id,session),id=randomUUID();
    const resolved:ActionStep[]=steps.map((command,index)=>{const target=this.target(command.objectId,snapshot,input.source!=='manual');return {index,command:{...command,...(input.source!=='manual'&&target.entityId?{confirmEntityId:target.entityId}:{})},identity:input.pins?.[index]??target.identity,name:target.name,roomId:target.roomId,provider:target.provider,status:'pending' as const,error:null,before:null,after:null,startedAt:null,endedAt:null};});
    const physicalKeys=resolved.map(step=>`${step.provider}:${step.command.confirmEntityId??this.store.home().objects.find(o=>o.id===step.command.objectId)?.actions.find(a=>a.type==='device')?.bindingId}`);
    if(new Set(physicalKeys).size!==physicalKeys.length)fail('ACTION_DUPLICATE_TARGET',400);
    // Recheck after asynchronous snapshot: another request may have claimed this ID.
    const concurrent=this.store.db.prepare('SELECT id,request_hash FROM action_runs WHERE actor=? AND request_id=?').get(actor.id,input.requestId) as {id:string;request_hash:string}|undefined;
    if(concurrent){if(concurrent.request_hash!==requestHash)fail('ACTION_IDEMPOTENCY_CONFLICT');return this.get(concurrent.id,actor.id);}
    const canceled=!!this.store.db.prepare('SELECT 1 FROM action_stops WHERE actor=? AND request_id=?').get(actor.id,input.requestId);
    const status=canceled?'stopped':input.source==='manual'||policy.mode!=='advise'?'awaiting_confirmation':'blocked';
    this.store.db.transaction(()=>{
      this.store.db.prepare('INSERT INTO action_runs(id,actor,request_id,request_hash,session_hash,source,channel,status,policy_version,ambient_id,ambient_version,failure_mode,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,actor.id,input.requestId,requestHash,session,input.source,input.channel,status,policy.version,input.ambient?.id??null,input.ambient?.version??null,input.failureMode??'stop',Date.now()+120000,now());
      for(const step of resolved)this.store.db.prepare('INSERT INTO action_steps VALUES(?,?,?)').run(id,step.index,JSON.stringify(step));
      this.event(id,null,'requested');
      if(status==='blocked'||status==='stopped'){for(const step of resolved){step.status='skipped';Object.assign(step,{error:status==='blocked'?'ACTION_ADVICE_ONLY':'ACTION_STOPPED',endedAt:now()});this.saveStep(id,step);}}
      if(status==='blocked'){this.finish(id,'blocked');this.event(id,null,'denied',{code:'ACTION_ADVICE_ONLY'});}
      if(status==='stopped'){this.finish(id,'stopped');this.event(id,null,'stop_requested');}
    })();return this.get(id);
  }
  async execute(id:string,actor:Identity,session:string,confirmed=false):Promise<ActionRun>{
    const row=this.row(id);if(!row||row.actor!==actor.id)return fail('ACTION_NOT_FOUND',404);
    if(row.session_hash!==session||!this.sessionValid(session,actor.id))return fail('AUTH_REQUIRED',401);
    const active=this.running.get(id);if(active)return active;
    if(terminal(row.status))return this.get(id);
    if(row.source!=='manual'&&this.policy(actor.id,session).mode==='confirm'&&!confirmed)return fail('ACTION_CONFIRMATION_REQUIRED',403);
    const promise=this.perform(id,actor,session);
    this.running.set(id,promise);
    try{return await promise;}finally{this.running.delete(id);}
  }
  private async perform(id:string,actor:Identity,session:string){
    this.store.db.prepare("UPDATE action_runs SET status='running' WHERE id=?").run(id);
    let stopped=false,uncertain=false,manualError:unknown;
    for(const step of this.get(id).steps){
      const run=this.get(id);
      let accepted=false;
      try{
        if(run.stopRequested){stopped=true;break;}
        if(Date.now()>run.expiresAt)fail('ACTION_EXPIRED');
        if(!this.sessionValid(session,actor.id))fail('AUTH_REQUIRED',401);
        const snapshot=await this.snapshot(run.source!=='manual'),target=this.target(step.command.objectId,snapshot,run.source!=='manual');
        // Policy, identity and Stop are checked after all awaited reads, at dispatch.
        if(this.get(id).stopRequested){stopped=true;break;}
        if(!this.sessionValid(session,actor.id))fail('AUTH_REQUIRED',401);
        if(target.identity!==step.identity)fail('ACTION_IDENTITY_CHANGED',403);
        if(run.source!=='manual')this.allowed(run,session,target,step.command);
        if(run.source!=='manual'&&!target.available)fail('DEVICE_UNAVAILABLE');
        if(this.devicesBusy.has(target.objectId))fail('ACTION_DEVICE_BUSY');
        if(Date.now()>run.expiresAt)fail('ACTION_EXPIRED');
        this.devicesBusy.add(target.objectId);step.status='dispatching';step.startedAt=now();step.before={state:target.state,brightness:target.brightness,sourceObservedAt:target.sourceObservedAt,receivedAt:now()};this.saveStep(id,step);this.event(id,step,'dispatch_started',{before:step.before});
        let timer:ReturnType<typeof setTimeout>|undefined;
        const command=this.dispatch(actor,step.command,()=>{accepted=true;this.event(id,step,'accepted');});
        // Keep the target quarantined until dispatch actually settles, even on timeout.
        void command.finally(()=>this.devicesBusy.delete(target.objectId)).catch(()=>undefined);
        let after:DeviceSnapshot;
        try{after=await Promise.race([command,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ActionError(408,'ACTION_TIMEOUT')),this.timeoutMs);})]);}finally{if(timer)clearTimeout(timer);}
        const observed=after.entities.find(e=>e.bindingId===this.store.home().objects.find(o=>o.id===step.command.objectId)?.actions.find(a=>a.type==='device')?.bindingId);
        const expected=step.command.action==='turn_off'?'off':'on';
        if(!observed)throw new ActionError(409,'ACTION_READBACK_UNCONFIRMED');
        if(observed.state!==expected||step.command.action==='set_brightness'&&(observed.brightness==null||Math.abs(observed.brightness-step.command.brightness!)>2))fail('ACTION_READBACK_UNCONFIRMED');
        step.after={state:observed.state,brightness:observed.brightness??null,sourceObservedAt:observed.observedAt??null,receivedAt:now()};step.status='confirmed';step.endedAt=now();this.saveStep(id,step);this.event(id,step,'confirmed',{after:step.after});
      }catch(e){
        const code=e instanceof Error&&/^[A-Z][A-Z0-9_]{1,79}$/.test(e.message)?e.message:'ACTION_FAILED';
        const rejected=e instanceof ActionError&&!['ACTION_TIMEOUT','ACTION_READBACK_UNCONFIRMED'].includes(code)||['HA_AUTH_FAILED','HA_BRIGHTNESS_UNSUPPORTED','HA_COMMAND_ENTITY_UNSUPPORTED','DEVICE_UNAVAILABLE','UNKNOWN_BINDING'].includes(code);
        uncertain=step.startedAt!==null&&(accepted||!rejected);
        step.status=uncertain?'uncertain':'failed';step.error=code;step.endedAt=now();this.saveStep(id,step);this.event(id,step,uncertain?'uncertain':e instanceof ActionError&&e.status===403?'denied':'failed',{code});
        if(run.source==='manual')manualError=e;
        if(uncertain||run.failureMode==='stop'||code.startsWith('ACTION_PERMISSION')||code.startsWith('ACTION_SCOPE')||code==='ACTION_ADVICE_ONLY'||code==='AUTH_REQUIRED')break;
      }
    }
    const run=this.get(id);stopped=stopped||run.stopRequested;
    for(const step of run.steps)if(step.status==='pending'){step.status='skipped';step.error=stopped?'ACTION_STOPPED':'ACTION_NOT_EXECUTED';step.endedAt=now();this.saveStep(id,step);}
    const steps=this.get(id).steps,good=steps.filter(s=>s.status==='confirmed').length;
    const status:RunStatus=stopped?'stopped':uncertain?'uncertain':good===steps.length?'succeeded':good?'partial':steps.some(s=>s.error==='ACTION_EXPIRED')?'expired':'failed';
    this.finish(id,status);this.event(id,null,'finished',{status});
    if(manualError)throw manualError;
    return this.get(id);
  }
  stop(id:string,actor:string){const run=this.get(id,actor);if(!terminal(run.status)&&!run.stopRequested){this.store.db.prepare('UPDATE action_runs SET stop_requested=1 WHERE id=?').run(id);this.event(id,null,'stop_requested');if(run.status==='awaiting_confirmation')this.finish(id,'stopped');}return this.get(id);}
  stopRequest(actor:string,requestId:string){this.store.db.prepare('INSERT OR IGNORE INTO action_stops VALUES(?,?,?)').run(actor,requestId,now());for(const row of this.store.db.prepare('SELECT id FROM action_runs WHERE actor=? AND request_id=?').all(actor,requestId) as {id:string}[])this.stop(row.id,actor);}
  list(actor:string){return (this.store.db.prepare('SELECT id FROM action_runs WHERE actor=? ORDER BY created_at DESC,id DESC LIMIT 30').all(actor) as {id:string}[]).map(r=>this.get(r.id));}
  ambients(){return (this.store.db.prepare('SELECT document FROM ambients a WHERE version=(SELECT max(version) FROM ambients WHERE id=a.id) ORDER BY created_at DESC').all() as {document:string}[]).map(r=>JSON.parse(r.document) as Ambient).filter(a=>!a.deleted).sort((a,b)=>Number(b.favorite)-Number(a.favorite));}
  async saveAmbient(actor:string,body:unknown){
    const input=ambientInputSchema.parse(body),snapshot=await this.snapshot(true);
    if(!this.store.home().rooms.some(r=>r.id===input.roomId))fail('ACTION_ROOM_REQUIRED',400);
    const run=input.runId?this.get(input.runId,actor):undefined;
    const commands=run?run.steps.map(s=>s.command):input.steps!;
    const steps=commands.map((command,index)=>{const t=this.target(command.objectId,snapshot);if(t.roomId!==input.roomId)fail('ACTION_ROOM_MISMATCH',400);return {command,identity:run?.steps[index].identity??t.identity,name:t.name,roomId:t.roomId,provider:t.provider};});
    const ambient:Ambient={id:input.id??randomUUID(),version:(input.expectedVersion??0)+1,name:input.name,roomId:input.roomId,favorite:input.favorite,deleted:input.deleted,failureMode:input.failureMode,steps};
    this.store.db.transaction(()=>{const latest=this.store.db.prepare('SELECT max(version) FROM ambients WHERE id=?').pluck().get(ambient.id) as number|null;if(input.id&&latest!==input.expectedVersion)fail('REVISION_CONFLICT');this.store.db.prepare('INSERT INTO ambients VALUES(?,?,?,?,?)').run(ambient.id,ambient.version,JSON.stringify(ambient),actor,now());this.store.audit(actor,'ambient.saved',`${ambient.id}:${ambient.version}`);})();return ambient;
  }
  async prepareAmbient(actor:Identity,session:string,id:string,requestId:string,version?:number,channel:ActionRun['channel']='button'){
    const ambient=this.ambients().find(a=>a.id===id);if(!ambient)return fail('AMBIENT_NOT_FOUND',404);
    if(version!==undefined&&version!==ambient.version)fail('REVISION_CONFLICT');
    return this.prepare(actor,session,{requestId,source:'ambient',channel,steps:ambient.steps.map(s=>s.command),pins:ambient.steps.map(s=>s.identity),failureMode:ambient.failureMode,ambient});
  }
  updateAmbient(actor:string,id:string,body:unknown){
    const input=z.object({expectedVersion:z.number().int().positive(),name:z.string().trim().min(1).max(80).optional(),favorite:z.boolean().optional(),deleted:z.boolean().optional()}).strict().parse(body);
    return this.store.db.transaction(()=>{const old=this.ambients().find(a=>a.id===id);if(!old)fail('AMBIENT_NOT_FOUND',404);if(old!.version!==input.expectedVersion)fail('REVISION_CONFLICT');const next={...old!,...input,id,version:old!.version+1};delete (next as Partial<typeof input>).expectedVersion;this.store.db.prepare('INSERT INTO ambients VALUES(?,?,?,?,?)').run(id,next.version,JSON.stringify(next),actor,now());this.store.audit(actor,'ambient.updated',`${id}:${next.version}`);return next;})();
  }
  async captureAmbient(actor:string,body:unknown){
    const input=z.object({name:z.string().trim().min(1).max(80),roomId:z.string().min(1).max(80),objectIds:z.array(z.string().min(1).max(80)).min(1).max(8)}).strict().parse(body),snapshot=await this.snapshot(true);
    const steps=input.objectIds.map(objectId=>{const t=this.target(objectId,snapshot);if(!t.available||!['on','off'].includes(t.state))fail('DEVICE_UNAVAILABLE');return {objectId,action:t.state==='off'?'turn_off' as const:t.actions.includes('set_brightness')&&t.brightness!==null&&t.brightness>=1?'set_brightness' as const:'turn_on' as const,...(t.state==='on'&&t.actions.includes('set_brightness')&&t.brightness!==null&&t.brightness>=1?{brightness:t.brightness}:{})};});
    return this.saveAmbient(actor,{name:input.name,roomId:input.roomId,steps});
  }
}

export function mountActions(app:Express,actions:Actions,store:Store,owner:RequestHandler){
  app.post('/api/v1/actions/stop-request',owner,(req,res)=>{const input=z.object({requestId:requestIdSchema}).strict().parse(req.body);actions.stopRequest(res.locals.user.id,input.requestId);res.json({stopped:true});});
  app.get('/api/v1/action-policy',owner,(_req,res)=>res.json(actions.policy(res.locals.user.id,res.locals.sessionHash)));
  app.put('/api/v1/action-policy',owner,async(req,res)=>res.json(await actions.setPolicy(res.locals.user.id,res.locals.sessionHash,req.body)));
  app.get('/api/v1/action-targets',owner,async(_req,res)=>res.json(await actions.targets()));
  app.get('/api/v1/action-runs',owner,(_req,res)=>res.json(actions.list(res.locals.user.id)));
  app.get('/api/v1/action-runs/:id',owner,(req,res)=>res.json(actions.get(String(req.params.id),res.locals.user.id)));
  app.get('/api/v1/action-runs/:id/events',owner,(req,res)=>{actions.get(String(req.params.id),res.locals.user.id);res.json(store.db.prepare('SELECT * FROM action_events WHERE run_id=? ORDER BY id').all(String(req.params.id)));});
  app.post('/api/v1/action-runs/:id/execute',owner,async(req,res)=>{z.object({confirmed:z.literal(true)}).strict().parse(req.body);res.json(await actions.execute(String(req.params.id),res.locals.user,res.locals.sessionHash,true));});
  app.post('/api/v1/action-runs/:id/stop',owner,(req,res)=>res.json(actions.stop(String(req.params.id),res.locals.user.id)));
  app.get('/api/v1/ambients',owner,(_req,res)=>res.json(actions.ambients()));
  app.post('/api/v1/ambients',owner,async(req,res)=>res.json(await actions.saveAmbient(res.locals.user.id,req.body)));
  app.post('/api/v1/ambients/capture',owner,async(req,res)=>res.json(await actions.captureAmbient(res.locals.user.id,req.body)));
  app.patch('/api/v1/ambients/:id',owner,(req,res)=>res.json(actions.updateAmbient(res.locals.user.id,String(req.params.id),req.body)));
  app.post('/api/v1/ambients/:id/run',owner,async(req,res)=>{const input=z.object({requestId:requestIdSchema,expectedVersion:z.number().int().positive(),confirmed:z.boolean().default(false)}).strict().parse(req.body);const run=await actions.prepareAmbient(res.locals.user,res.locals.sessionHash,String(req.params.id),input.requestId,input.expectedVersion);res.json(run.status==='blocked'?run:await actions.execute(run.id,res.locals.user,res.locals.sessionHash,input.confirmed));});
}

export const manualCommandSchema=actionSchema.safeExtend({requestId:requestIdSchema.optional()});

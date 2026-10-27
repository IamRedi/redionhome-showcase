import {readFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {Express,RequestHandler} from 'express';
import {z} from 'zod';
import {productConfigSchema,productNames,type ProductConnection,type ProductId,type ProductReport,type ProductAIContext} from '../shared/product-integrations.ts';
import {idSchema} from '../shared/model.ts';
import {requestIdSchema} from '../shared/actions.ts';
import type {Store} from './store.ts';
import type {HomeAssistantPilot} from './home-assistant.ts';
import {ActionError} from './commands.ts';

const pianoIdentity=z.object({device_id:z.string().uuid(),identity_schema:z.literal(1),product:z.literal('Piano Core')});
const pianoHealth=z.object({status:z.enum(['ok','ready','degraded','error']),application:z.object({state:z.string().max(40)}),midi_input:z.object({connection:z.string().max(40)}).optional(),playback:z.object({state:z.string().max(40),available:z.boolean()}).optional()});
const ledIdentity=z.object({deviceId:z.string().max(100),deviceType:z.literal('visual_display_v1'),protocolVersion:z.literal(1),fwVersion:z.string().max(60),capabilities:z.array(z.string().max(80)).max(64)});
const ledState=z.object({deviceId:z.string().max(100),available:z.boolean(),brightness:z.object({current:z.number().min(0).max(100),max:z.number().min(0).max(100)}),currentMode:z.string().max(80),activeScene:z.string().max(80).nullable().optional(),activeAnimation:z.string().max(80).nullable().optional(),fwVersion:z.string().max(60).optional()});
const registrySchema=z.object({animations:z.array(z.string().min(1).max(80)).max(200)});
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Read-only adapters: only fixed GET paths on an operator-configured origin. */
export class ProductIntegrations{
 private pending=new Map<string,Promise<ProductReport>>();
 private cache=new Map<string,{key:string;expires:number;report:ProductReport}>();
 constructor(private store:Store,private root:string,private ha:HomeAssistantPilot,private fetcher:typeof fetch=fetch,private fixture?:unknown){}
 private config(){
  if(this.fixture!==undefined)return productConfigSchema.parse(this.fixture);
  const file=path.join(this.root,'product-connections.json');
  try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>32768)throw Error('PRODUCT_CONFIG_UNSAFE');return productConfigSchema.parse(JSON.parse(readFileSync(file,'utf8')));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {version:1 as const,connections:[]};throw new ActionError(503,'PRODUCT_CONFIG_INVALID');}
 }
 private object(id:string){const object=this.store.home().objects.find(o=>o.id===id);if(!object)throw new ActionError(404,'PRODUCT_OBJECT_NOT_FOUND');return object;}
 private product(id:string,connection?:ProductConnection):ProductId|undefined{
  const object=this.object(id);
  if(connection){if(connection.product==='piano-core'&&object.kind!=='piano'||connection.product==='philips-tv'&&object.kind!=='tv'||connection.product==='bambu-lab'&&object.kind!=='printer')throw new ActionError(409,'PRODUCT_OBJECT_CHANGED');return connection.product;}
  const action=object.actions.find(a=>a.type==='integration'&&['piano-core','led-wall','bambu-lab'].includes(a.adapterId));
  return action?.type==='integration'?action.adapterId as ProductId:object.kind==='tv'?'philips-tv':undefined;
 }
 list(){
  const config=this.config();
  return this.store.home().objects.flatMap(object=>{const connection=config.connections.find(c=>c.objectId===object.id),product=this.product(object.id,connection);return product?[{objectId:object.id,name:object.name,product,configured:!!connection}]:[];});
 }
 async aiContext():Promise<ProductAIContext[]>{
  let ids:string[];try{ids=this.list().filter(x=>x.configured).slice(0,8).map(x=>x.objectId);}catch{return [];}
  const reports=await Promise.allSettled(ids.map(id=>this.report(id)));
  return reports.flatMap(r=>r.status==='fulfilled'?[{objectId:r.value.objectId,product:r.value.product,status:r.value.status,identityVerified:r.value.identityVerified,readings:r.value.readings,receivedAt:r.value.receivedAt,commandSupported:r.value.commandSupported,unsupportedMetrics:r.value.unsupportedMetrics}]:[]);
 }
 private async json(origin:string,route:string){
  const response=await this.fetcher(new URL(route,origin),{method:'GET',redirect:'error',signal:AbortSignal.timeout(4000),headers:{Accept:'application/json'}});
  if(!response.ok||Number(response.headers.get('content-length')??0)>65536)throw Error('PRODUCT_UNAVAILABLE');
  // Bound streamed bytes as well as the optional length header.
  const reader=response.body?.getReader();if(!reader)throw Error('PRODUCT_UNAVAILABLE');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)throw Error('PRODUCT_RESPONSE_TOO_LARGE');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>undefined);throw e;}finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
 }
 async report(id:string):Promise<ProductReport>{
  const config=this.config(),connection=config.connections.find(c=>c.objectId===id),product=this.product(id,connection);
  if(!product)throw new ActionError(404,'PRODUCT_NOT_CONFIGURED');
  const key=digest({connection,product,object:this.object(id).provider,binding:this.ha.binding(id)}),cached=this.cache.get(id);
  if(cached?.key===key&&cached.expires>Date.now())return cached.report;
  const pending=this.pending.get(id);if(pending)return pending;
  const request=this.read(id,product,connection).then(report=>{
   // Never return a result from a connection that changed during an awaited read.
   const latest=this.config().connections.find(c=>c.objectId===id);
   if(digest({connection:latest,product:this.product(id,latest),object:this.object(id).provider,binding:this.ha.binding(id)})!==key)throw new ActionError(409,'PRODUCT_OBJECT_CHANGED');
   this.cache.set(id,{key,expires:Date.now()+15000,report});
   this.observe(report);return report;
  });
  this.pending.set(id,request);try{return await request;}finally{this.pending.delete(id);}
 }
 private async read(id:string,product:ProductId,c?:ProductConnection):Promise<ProductReport>{
  const report:ProductReport={objectId:id,product,name:productNames[product],status:'unconfigured',identityVerified:false,readings:[],presets:[],launchUrl:null,launchLabel:product==='piano-core'?'Hap Piano Core':product==='led-wall'?'Hap panelin e plotë':'Hap aplikacionin',message:'Lidhja private nuk është konfiguruar.',receivedAt:new Date().toISOString(),commandSupported:false,physicalResult:'NOT_VERIFIED',unsupportedMetrics:product==='piano-core'?['Kohë praktike','Energji','Kosto']:product==='led-wall'?['Energji e matur','Rezultat fizik']:product==='bambu-lab'?['Material dhe kosto pa sensor','Energji pa matës']:['Modeli fizik','Aktori i ndryshimeve të jashtme']};
  if(!c&&product!=='philips-tv')return report;
  try{
   if(product==='piano-core'){
    const identity=pianoIdentity.parse(await this.json(c!.origin!,'/api/v1/device'));
    if(identity.device_id!==c!.expectedDeviceId){report.status='identity_mismatch';report.message='Identiteti i Piano Core ndryshoi. Kontrolloni lidhjen.';return report;}
    const health=pianoHealth.parse(await this.json(c!.origin!,'/api/v1/health'));
    report.identityVerified=true;report.status=health.application.state==='READY'&&['ok','ready'].includes(health.status)?'online':'degraded';
    report.launchUrl=c!.origin+'/';report.message='Hap ndërfaqen ekzistuese. Hapja nuk nis playback ose praktikë.';
    report.readings=[{label:'Aplikacioni',value:health.application.state,sourceObservedAt:null},...(health.midi_input?[{label:'MIDI',value:health.midi_input.connection,sourceObservedAt:null}]:[]),...(health.playback?[{label:'Playback',value:health.playback.state,sourceObservedAt:null},{label:'Dalja MIDI',value:health.playback.available?'E disponueshme':'E padisponueshme',sourceObservedAt:null}]:[])];
   }else if(product==='led-wall'){
    const identity=ledIdentity.parse(await this.json(c!.origin!,'/identity'));
    if(c!.expectedDeviceId&&identity.deviceId!==c!.expectedDeviceId){report.status='identity_mismatch';report.message='Identiteti i LED Wall nuk përputhet me lidhjen.';return report;}
    const state=ledState.parse(await this.json(c!.origin!,'/state'));
    if(state.deviceId!==identity.deviceId)throw Error('PRODUCT_IDENTITY_CHANGED');
    report.identityVerified=!!identity.deviceId&&identity.deviceId===c!.expectedDeviceId;
    report.status=!state.available?'offline':report.identityVerified?'online':'identity_unverified';
    report.message=report.identityVerified?'Gjendje e lexuar nga LED Wall. Komandat fizike kërkojnë provën e tyre.':'Adresa përgjigjet, por identiteti fizik nuk është verifikuar. Komandat mbeten të bllokuara.';
    report.launchUrl=c!.origin+'/';
    report.readings=[{label:'Firmware',value:identity.fwVersion,sourceObservedAt:null},{label:'Mënyra',value:state.currentMode,sourceObservedAt:null},{label:'Ndriçimi',value:state.brightness.current,unit:'%',sourceObservedAt:null},{label:'Kufiri i pajisjes',value:state.brightness.max,unit:'%',sourceObservedAt:null}];
    try{report.presets=registrySchema.parse(await this.json(c!.origin!,'/registry')).animations;}catch{/* Presets are optional; never invent a registry. */}
   }else{
    if(product==='philips-tv'){
     if(this.ha.info().configured)await this.ha.refresh();
     const object=this.object(id),binding=this.ha.binding(id),device=this.ha.snapshot().find(d=>d.bindingId===binding?.binding_id);
     const active=object.actions.some(a=>a.type==='device'&&a.bindingId===binding?.binding_id)&&object.provider?.active==='home-assistant';
     if(!active||!device){report.message='Lidhni entitetin e saktë të TV-së në Home Assistant.';return report;}
     report.status=device.state==='unavailable'?'offline':'online';report.identityVerified=false;
     report.message='Gjendje nga lidhja ekzistuese Home Assistant. Modeli dhe telekomanda fizike ende nuk janë verifikuar.';
     report.readings=[{label:'Gjendja',value:device.statusText??device.state,sourceObservedAt:device.observedAt??null},...Object.entries(device.values??{}).filter(([k])=>['volume_level','media_title','media_artist'].includes(k)).flatMap(([key,value])=>typeof value==='string'||typeof value==='number'?[{label:key==='volume_level'?'Volumi':key==='media_title'?'Titulli':'Artisti',value,sourceObservedAt:device.observedAt??null}]:[])];
    }else{
     if(!Object.keys(c!.sensors??{}).length)return report;
     const inventory=await this.ha.inventory();
     const labels={status:'Gjendja',progress:'Progresi',remaining:'Koha e mbetur',nozzle:'Gryka',bed:'Platforma',error:'Gabimi'};
     for(const [metric,entityId]of Object.entries(c!.sensors??{})){
      const entity=inventory.find(e=>e.entityId===entityId);if(!entity||entity.state==='unavailable')continue;
      const unit=entity.values.unit_of_measurement,value=entity.values.value;
      if(value===undefined||value===null||typeof value==='boolean')continue;
      report.readings.push({label:labels[metric as keyof typeof labels],value:typeof value==='string'?value.slice(0,160):value,...(typeof unit==='string'?{unit}:{}),sourceObservedAt:entity.observedAt});
     }
     report.status=report.readings.length?'online':Object.keys(c!.sensors??{}).length?'offline':'unconfigured';
     report.message='Vetëm sensorët e zgjedhur shprehimisht nga Home Assistant. Pa komanda printimi, ngrohjeje ose lëvizjeje.';
    }
   }
  }catch{report.status='offline';report.readings=[];report.presets=[];report.launchUrl=null;report.message='Burimi nuk dha një përgjigje të vlefshme. Gjendja e vjetër nuk paraqitet si lexim i ri.';}
  return report;
 }
 private observe(report:ProductReport){
  const detail={objectId:report.objectId,product:report.product,status:report.status,identityVerified:report.identityVerified,readings:report.readings,initiator:'external_or_unknown'};
  const last=this.store.db.prepare("SELECT detail FROM audit WHERE action='integration.observed' AND json_extract(detail,'$.objectId')=? ORDER BY id DESC LIMIT 1").get(report.objectId) as {detail:string}|undefined;
  if(last?.detail!==JSON.stringify(detail))this.store.audit('external_or_unknown','integration.observed',JSON.stringify(detail));
 }
 async launch(actor:string,id:string,requestId:string){
  const report=await this.report(id);if(!report.launchUrl)throw new ActionError(409,'PRODUCT_LAUNCH_UNAVAILABLE');
  const old=this.store.db.prepare("SELECT detail FROM audit WHERE action='integration.open_requested' AND actor=? AND json_extract(detail,'$.requestId')=? LIMIT 1").get(actor,requestId) as {detail:string}|undefined;
  if(old&&JSON.parse(old.detail).objectId!==id)throw new ActionError(409,'ACTION_IDEMPOTENCY_CONFLICT');
  if(!old)this.store.audit(actor,'integration.open_requested',JSON.stringify({requestId,objectId:id,product:report.product,channel:'button',result:'open_requested',processStarted:false}));
  return {url:report.launchUrl,result:'open_requested' as const,processStarted:false};
 }
}

export function mountProductIntegrations(app:Express,products:ProductIntegrations,owner:RequestHandler){
 app.get('/api/v1/product-integrations',owner,(_req,res)=>res.json(products.list()));
 app.get('/api/v1/product-integrations/:id',owner,async(req,res)=>res.json(await products.report(idSchema.parse(req.params.id))));
 app.post('/api/v1/product-integrations/:id/open',owner,async(req,res)=>{const {requestId}=z.object({requestId:requestIdSchema}).strict().parse(req.body);res.json(await products.launch(res.locals.user.id,idSchema.parse(req.params.id),requestId));});
}

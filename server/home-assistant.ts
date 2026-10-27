import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import type { Store } from './store.ts';
import type { DeviceState } from '../shared/model.ts';
import {deviceCategoryFromDomain,type DeviceCapability,type DeviceValue} from '../shared/device-catalog.ts';

const stateSchema=z.array(z.object({entity_id:z.string(),state:z.string(),attributes:z.record(z.string(),z.unknown()),last_updated:z.string().optional()}));
type Entity=z.infer<typeof stateSchema>[number];
const readablePowerEntityId=(id:string)=>/^(?:light|switch)\.[a-z0-9_]+$/.test(id);
const visibleDeviceDomain=new Set(['light','switch','cover','sensor','binary_sensor','climate','fan','media_player','valve','lock']);
const supportsBrightness=(entity:Entity|undefined)=>Array.isArray(entity?.attributes.supported_color_modes)&&entity.attributes.supported_color_modes.some(mode=>typeof mode==='string'&&['brightness','color_temp','hs','xy','rgb','rgbw','rgbww','white'].includes(mode));
const supportsColor=(entity:Entity|undefined)=>Array.isArray(entity?.attributes.supported_color_modes)&&entity.attributes.supported_color_modes.some(mode=>typeof mode==='string'&&['hs','xy','rgb','rgbw','rgbww'].includes(mode));
const scalar=(value:unknown):DeviceValue|undefined=>typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null?value:undefined;
const addValue=(values:Record<string,DeviceValue>,key:string,value:unknown)=>{const safe=scalar(value);if(safe!==undefined)values[key]=typeof safe==='string'?safe.slice(0,160):safe;};
export type HaInventoryItem=ReturnType<typeof describeEntity>;
export function describeEntity(entity:Entity|undefined,entityId=entity?.entity_id??'unknown.unknown'){
  const domain=entityId.split('.')[0],attributes=entity?.attributes??{},name=typeof attributes.friendly_name==='string'?attributes.friendly_name:entityId;
  const category=deviceCategoryFromDomain(domain,name,typeof attributes.device_class==='string'?attributes.device_class:'');
  const capabilities:DeviceCapability[]=[];
  const commandCapabilities:DeviceCapability[]=[];
  if(['light','switch','fan'].includes(domain))capabilities.push('power');
  if(domain==='light')commandCapabilities.push('power');
  if(domain==='switch')commandCapabilities.push('power');
  if(domain==='light'&&supportsBrightness(entity)){capabilities.push('brightness');commandCapabilities.push('brightness');}
  if(domain==='light'&&supportsColor(entity))capabilities.push('color');
  if(domain==='sensor'||domain==='binary_sensor')capabilities.push('telemetry');
  if(domain==='climate')capabilities.push('thermostat','temperature');
  if(domain==='cover'||domain==='valve')capabilities.push('position');
  if(domain==='media_player')capabilities.push('playback','volume');
  if(domain==='lock')capabilities.push('lock');
  const deviceClass=typeof attributes.device_class==='string'?attributes.device_class:'';
  if(deviceClass==='temperature'&&!capabilities.includes('temperature'))capabilities.push('temperature');
  if(deviceClass==='humidity')capabilities.push('humidity');
  if(['energy','power'].includes(deviceClass))capabilities.push('energy');
  const rawState=entity?.state?.slice(0,160)??'unavailable';
  const unavailable=!entity||rawState==='unavailable'||rawState==='unknown';
  const state:DeviceState['state']=unavailable?'unavailable':rawState==='on'?'on':rawState==='off'?'off':'available';
  const values:Record<string,DeviceValue>={};
  if(!unavailable)addValue(values,'value',rawState);
  for(const key of ['unit_of_measurement','current_temperature','temperature','humidity','current_position','position','volume_level','hvac_action','media_title','media_artist','battery_level'])addValue(values,key,attributes[key]);
  if(typeof attributes.brightness==='number')values.brightness=Math.round(attributes.brightness/255*100);
  return {entityId,name,domain,source:'home-assistant' as const,state,rawState,availability:unavailable?'unavailable' as const:'online' as const,observedAt:entity?.last_updated??null,supported:visibleDeviceDomain.has(domain),category,capabilities:[...new Set(capabilities)],commandCapabilities:[...new Set(commandCapabilities)],values};
}
export type HaStatus='UNCONFIGURED'|'CONNECTING'|'CONNECTED'|'UNAVAILABLE'|'ERROR';
export function validateHaOrigin(value:string,allowed:string[]):string{
  let url:URL;
  try{url=new URL(value);}catch{throw Error('HA_ORIGIN_INVALID');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.hostname||!allowed.includes(url.origin))throw Error('HA_ORIGIN_NOT_ALLOWED');
  return url.origin;
}
export class HomeAssistantPilot {
  private origin:string|null=null;
  private token:string|null=null;
  private ws:WebSocket|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private retry=1000;
  private generation=0;
  private socketReady=false;
  private entities=new Map<string,Entity>();
  private allStates=new Map<string,Entity>();
  private status:HaStatus='UNCONFIGURED';
  private error:string|null=null;
  constructor(private store:Store,private allowed:string[],private tokenFile:string|undefined,private fetcher:typeof fetch=fetch,private socketFactory:(url:string)=>WebSocket=url=>new WebSocket(url),private approvedLightId?:string){
    const row=store.db.prepare('SELECT origin FROM ha_connection WHERE id=1').get() as {origin:string}|undefined;
    if(row){try{this.origin=validateHaOrigin(row.origin,allowed);this.status='UNAVAILABLE';}catch{this.status='ERROR';this.error='HA_ORIGIN_NOT_ALLOWED';}}
  }
  private credential():string{
    if(!this.tokenFile)throw Error('HA_TOKEN_UNCONFIGURED');
    let stat:ReturnType<typeof statSync>;
    try{stat=statSync(this.tokenFile);}catch{throw Error('HA_TOKEN_UNCONFIGURED');}
    if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('HA_TOKEN_FILE_UNSAFE');
    let token:string;
    try{token=readFileSync(this.tokenFile,'utf8').trim();}catch{throw Error('HA_TOKEN_UNCONFIGURED');}
    if(!token)throw Error('HA_TOKEN_UNCONFIGURED');
    return token;
  }
  info(){return {status:this.status,configured:!!this.origin,origin:this.origin,error:this.error,commandEnabled:!!this.approvedLightId||!!this.store.db.prepare('SELECT 1 FROM ha_bindings WHERE control_enabled=1 LIMIT 1').get()};}
  private async request(route:string,init:RequestInit={}):Promise<Response>{
    if(!this.origin)throw Error('HA_UNCONFIGURED');
    const token=this.token??this.credential();
    let response:Response;
    try{response=await this.fetcher(new URL(route,this.origin),{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});}
    catch{this.status='UNAVAILABLE';this.entities.clear();this.allStates.clear();throw Error('HA_UNAVAILABLE');}
    if(response.status===401||response.status===403){this.status='ERROR';this.entities.clear();this.allStates.clear();throw Error('HA_AUTH_FAILED');}
    if(!response.ok){this.status='UNAVAILABLE';this.entities.clear();this.allStates.clear();throw Error('HA_UNAVAILABLE');}
    return response;
  }
  async test(origin?:string){
    if(origin)this.origin=validateHaOrigin(origin,this.allowed);
    if(!this.origin)throw Error('HA_UNCONFIGURED');
    this.status='CONNECTING';this.error=null;
    try{
      this.token=this.credential();
      await this.request('/api/');
      const states=stateSchema.parse(await (await this.request('/api/states')).json());
      this.allStates=new Map(states.map(e=>[e.entity_id,e]));
      this.entities=new Map(states.filter(e=>readablePowerEntityId(e.entity_id)).map(e=>[e.entity_id,e]));
      this.status=this.socketReady?'CONNECTED':'CONNECTING';return this.info();
    }catch(e){const code=e instanceof Error&&e.message.startsWith('HA_')?e.message:'HA_UNAVAILABLE';this.status=code==='HA_AUTH_FAILED'||code.startsWith('HA_TOKEN')?'ERROR':'UNAVAILABLE';this.error=code;this.entities.clear();this.allStates.clear();throw Error(code,{cause:e});}
  }
  async configure(origin:string){
    const previous=this.origin;
    const selected=validateHaOrigin(origin,this.allowed);
    if(previous&&previous!==selected)throw Error('HA_DUPLICATE_PROVIDER');
    try{await this.test(selected);}catch(e){this.origin=previous;throw e;}
    this.store.db.prepare('INSERT INTO ha_connection(id,origin) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin').run(selected);
    this.store.audit('owner','ha.connection.configured','home-assistant');
    this.connect();return this.info();
  }
  async discover(){await this.test();return [...this.entities.values()].map(e=>({entityId:e.entity_id,name:typeof e.attributes.friendly_name==='string'?e.attributes.friendly_name:e.entity_id,state:e.state==='on'||e.state==='off'?e.state:'unavailable',capabilities:['power']}));}
  async inventory(){
    await this.test();
    return [...this.allStates.values()].filter(e=>visibleDeviceDomain.has(e.entity_id.split('.')[0])).map(e=>describeEntity(e)).sort((a,b)=>a.name.localeCompare(b.name)||a.entityId.localeCompare(b.entityId));
  }
  state(entityId:string):DeviceState['state']{if(this.status!=='CONNECTED')return 'unavailable';const state=this.entities.get(entityId)?.state;return state==='on'||state==='off'?state:'unavailable';}
  async refresh(){
    try{const states=stateSchema.parse(await (await this.request('/api/states')).json());this.allStates=new Map(states.map(e=>[e.entity_id,e]));this.entities=new Map(states.filter(e=>readablePowerEntityId(e.entity_id)).map(e=>[e.entity_id,e]));this.status=this.socketReady?'CONNECTED':'CONNECTING';this.error=null;}
    catch(e){this.status='UNAVAILABLE';this.entities.clear();this.allStates.clear();throw Error(e instanceof Error&&e.message.startsWith('HA_')?e.message:'HA_UNAVAILABLE',{cause:e});}
  }
  snapshot(){const rows=this.store.db.prepare('SELECT binding_id,entity_id,control_enabled FROM ha_bindings').all() as {binding_id:string;entity_id:string;control_enabled:number}[];return rows.map(row=>{const entity=this.allStates.get(row.entity_id),descriptor=describeEntity(entity,row.entity_id);return {bindingId:row.binding_id,entityId:row.entity_id,name:descriptor.name,state:descriptor.state,source:'home-assistant' as const,observedAt:descriptor.observedAt,category:descriptor.category,availability:descriptor.availability,statusText:descriptor.rawState,values:descriptor.values,capabilities:descriptor.capabilities,commandCapabilities:descriptor.commandCapabilities,controlEnabled:row.control_enabled===1&&descriptor.commandCapabilities.includes('power'),brightness:typeof descriptor.values.brightness==='number'?descriptor.values.brightness:null};});}
  binding(objectId:string){return this.store.db.prepare('SELECT binding_id,object_id,entity_id,control_enabled FROM ha_bindings WHERE object_id=?').get(objectId) as {binding_id:string;object_id:string;entity_id:string;control_enabled:number}|undefined;}
  async command(entityId:string,action:'turn_on'|'turn_off'|'set_brightness',brightness?:number,onAccepted?:()=>void){
    if(!/^(?:light|switch)\.[a-z0-9_]+$/.test(entityId))throw Error('HA_COMMAND_ENTITY_UNSUPPORTED');
    if(this.status!=='CONNECTED'||this.state(entityId)==='unavailable')throw Error('DEVICE_UNAVAILABLE');
    const domain=entityId.split('.')[0];
    if(action==='set_brightness'&&(domain!=='light'||brightness===undefined||!Number.isInteger(brightness)||brightness<1||brightness>100||!supportsBrightness(this.entities.get(entityId))))throw Error('HA_BRIGHTNESS_UNSUPPORTED');
    await this.request(`/api/services/${domain}/${action==='set_brightness'?'turn_on':action}`,{method:'POST',body:JSON.stringify({entity_id:entityId,...(action==='set_brightness'?{brightness:Math.round(brightness!*255/100)}:{})})});
    onAccepted?.();
    const deadline=Date.now()+8000;
    do{
      await this.refresh();
      if(this.state(entityId)===(action==='turn_off'?'off':'on')){
        if(action!=='set_brightness')return;
        const actual=this.entities.get(entityId)?.attributes.brightness;
        if(typeof actual==='number'&&Math.abs(actual-Math.round(brightness!*255/100))<=3)return;
      }
      await new Promise(resolve=>setTimeout(resolve,350));
    }while(Date.now()<deadline);
    throw Error('HA_STATE_NOT_CONFIRMED');
  }
  connect(){
    if(!this.origin)return;
    const generation=++this.generation;
    if(this.timer)clearTimeout(this.timer);
    this.ws?.close();this.socketReady=false;this.status='CONNECTING';
    let socket:WebSocket;
    try{const url=new URL('/api/websocket',this.origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';socket=this.socketFactory(url.toString());}
    catch{this.status='UNAVAILABLE';this.entities.clear();this.schedule(generation);return;}
    this.ws=socket;
    const timeout=setTimeout(()=>socket.close(),7000);
    socket.addEventListener('message',event=>{
      if(generation!==this.generation)return;
      let message:unknown;try{message=JSON.parse(String(event.data));}catch{return;}
      if(!message||typeof message!=='object')return;
      const m=message as Record<string,unknown>;
      if(m.type==='auth_required'){
        try{socket.send(JSON.stringify({type:'auth',access_token:this.token??this.credential()}));}
        catch{this.status='ERROR';this.error='HA_TOKEN_UNCONFIGURED';socket.close();}
        return;
      }
      if(m.type==='auth_invalid'){this.socketReady=false;this.status='ERROR';this.error='HA_AUTH_FAILED';this.allStates.clear();socket.close();return;}
      if(m.type==='auth_ok'){socket.send(JSON.stringify({id:1,type:'subscribe_events',event_type:'state_changed'}));return;}
      if(m.type==='result'&&m.id===1){if(m.success!==true){this.status='ERROR';this.error='HA_SUBSCRIPTION_FAILED';socket.close();return;}clearTimeout(timeout);this.socketReady=true;this.retry=1000;void this.refresh().catch(()=>{this.status='UNAVAILABLE';this.entities.clear();});return;}
      if(m.type==='event'&&m.id===1){const event=m.event as {data?:{entity_id?:unknown;new_state?:unknown}}|undefined;const id=event?.data?.entity_id;if(typeof id==='string'){const next=stateSchema.element.safeParse(event?.data?.new_state);if(next.success)this.allStates.set(id,next.data);else this.allStates.delete(id);if(readablePowerEntityId(id)){if(next.success)this.entities.set(id,next.data);else this.entities.delete(id);}}}
    });
    socket.addEventListener('error',()=>{socket.close();});
    socket.addEventListener('close',()=>{clearTimeout(timeout);if(generation!==this.generation)return;this.socketReady=false;this.entities.clear();this.allStates.clear();if(this.status!=='ERROR')this.status='UNAVAILABLE';this.schedule(generation);});
  }
  private schedule(generation:number){if(generation!==this.generation)return;this.timer=setTimeout(()=>this.connect(),this.retry);this.timer.unref?.();this.retry=Math.min(this.retry*2,30000);}
  close(){this.generation++;this.socketReady=false;if(this.timer)clearTimeout(this.timer);this.ws?.close();}
}

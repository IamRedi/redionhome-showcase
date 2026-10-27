import {readFileSync, lstatSync} from 'node:fs';
import {z} from 'zod';

const apiOrigin='https://api.smartthings.com';
const deviceSchema=z.object({deviceId:z.string().uuid(),label:z.string().optional(),name:z.string().optional(),components:z.array(z.object({id:z.string(),capabilities:z.array(z.object({id:z.string()}))}))});
const listSchema=z.object({items:z.array(deviceSchema).max(200),_links:z.object({next:z.object({href:z.string()}).optional()}).optional()});
export type SmartThingsDevice=z.infer<typeof deviceSchema>;
export const supportsSwitch=(device:SmartThingsDevice)=>device.components.some(component=>component.id==='main'&&component.capabilities.some(capability=>capability.id==='switch'));
export type SmartThingsState={deviceId:string;state:'on'|'off'|'unavailable';observedAt:string|null;source:'smartthings'};

// Diagnostic-only read path. OAuth account connection remains gated on official app registration.
export class SmartThingsReadOnly {
  private states=new Map<string,{at:number,value:SmartThingsState}>();
  private inventory:{at:number,value:SmartThingsDevice[]}|null=null;
  constructor(private tokenFile:string|undefined,private fetcher:typeof fetch=fetch,private now:()=>number=Date.now){}
  configured(){return !!this.tokenFile;}
  private token(){
    if(!this.tokenFile)throw Error('ST_AUTH_BLOCKED');
    let stat:ReturnType<typeof lstatSync>;
    try{stat=lstatSync(this.tokenFile);}catch(e){throw Error('ST_TOKEN_MISSING',{cause:e});}
    if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('ST_TOKEN_FILE_UNSAFE');
    const value=readFileSync(this.tokenFile,'utf8').trim();
    if(!value)throw Error('ST_TOKEN_MISSING');
    return value;
  }
  private async get(path:string){
    const url=new URL(path,apiOrigin);
    if(url.origin!==apiOrigin||!url.pathname.startsWith('/v1/'))throw Error('ST_URL_NOT_ALLOWED');
    let response:Response;
    try{response=await this.fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${this.token()}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});}
    catch(e){if(e instanceof Error&&e.message.startsWith('ST_'))throw e;throw Error('ST_UNAVAILABLE',{cause:e});}
    if(response.status===401||response.status===403)throw Error('ST_AUTH_REQUIRED');
    if(response.status===429)throw Error('ST_RATE_LIMITED');
    if(!response.ok)throw Error('ST_UNAVAILABLE');
    return response.json() as Promise<unknown>;
  }
  async discover():Promise<SmartThingsDevice[]>{
    if(this.inventory&&this.now()-this.inventory.at<20_000)return this.inventory.value;
    const found:SmartThingsDevice[]=[];
    let next='/v1/devices';
    const seen=new Set<string>();
    for(let page=0;page<5;page++){
      if(seen.has(next))throw Error('ST_PAGINATION_LOOP');
      seen.add(next);
      const data=listSchema.parse(await this.get(next));
      found.push(...data.items);
      if(found.length>500)throw Error('ST_DISCOVERY_LIMIT');
      if(!data._links?.next){this.inventory={at:this.now(),value:found};return found;}
      const url=new URL(data._links.next.href,apiOrigin);
      if(url.origin!==apiOrigin||url.pathname!=='/v1/devices')throw Error('ST_URL_NOT_ALLOWED');
      next=url.pathname+url.search;
    }
    throw Error('ST_DISCOVERY_LIMIT');
  }
  async state(deviceId:string):Promise<SmartThingsState>{
    const id=z.string().uuid().parse(deviceId);
    const cached=this.states.get(id);
    if(cached&&this.now()-cached.at<10_000)return cached.value;
    const health=z.object({state:z.string(),lastUpdatedDate:z.string().optional()}).parse(await this.get(`/v1/devices/${id}/health`));
    if(health.state!=='ONLINE'){
      const result:SmartThingsState={deviceId:id,state:'unavailable',observedAt:health.lastUpdatedDate??null,source:'smartthings'};
      this.states.set(id,{at:this.now(),value:result});
      return result;
    }
    const raw=await this.get(`/v1/devices/${id}/status`);
    const data=z.object({components:z.record(z.string(),z.unknown())}).parse(raw);
    const main=data.components.main;
    const switchValue=z.object({switch:z.object({switch:z.object({value:z.unknown(),timestamp:z.string().optional()})})}).safeParse(main);
    const value=switchValue.success?switchValue.data.switch.switch.value:null;
    const timestamp=switchValue.success?switchValue.data.switch.switch.timestamp:null;
    const result:SmartThingsState={deviceId:id,state:value==='on'||value==='off'?value:'unavailable',observedAt:timestamp??null,source:'smartthings'};
    this.states.set(id,{at:this.now(),value:result});
    return result;
  }
}

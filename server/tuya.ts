import {createHash,createHmac,randomUUID} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';

// The region is selected in the Tuya project; never accept an arbitrary API URL.
const origins={cn:'https://openapi.tuyacn.com',us:'https://openapi.tuyaus.com',ue:'https://openapi-ueaz.tuyaus.com',eu:'https://openapi.tuyaeu.com',we:'https://openapi-weaz.tuyaeu.com',in:'https://openapi.tuyain.com',sg:'https://openapi-sg.iotbing.com'} as const;
const configSchema=z.object({region:z.enum(['cn','us','ue','eu','we','in','sg']),clientId:z.string().regex(/^[A-Za-z0-9]{8,80}$/),clientSecret:z.string().min(8).max(200),uid:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/)}).strict();
const statusSchema=z.object({code:z.string(),value:z.unknown()});
const deviceSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),name:z.string().max(200),online:z.boolean(),status:z.array(statusSchema).max(200).optional(),update_time:z.number().int().nonnegative().optional()});
const tokenSchema=z.object({success:z.literal(true),result:z.object({access_token:z.string().min(1),expire_time:z.number().positive()})});
const deviceListSchema=z.object({success:z.literal(true),result:z.array(deviceSchema).max(50)});
const deviceDetailSchema=z.object({success:z.literal(true),result:deviceSchema});
export type TuyaDevice=z.infer<typeof deviceSchema>;
export type TuyaState={deviceId:string;state:'on'|'off'|'unavailable';observedAt:string|null;source:'tuya'};

const switchCode=(device:TuyaDevice)=>{
  const codes=(device.status??[]).filter(s=>typeof s.value==='boolean'&&/^switch(?:_led|_[1-9]\d*)?$/.test(s.code));
  return codes.length===1?codes[0]:null;
};
export const supportsTuyaSwitch=(device:TuyaDevice)=>!!switchCode(device);

// Diagnostic project credential only: no command endpoint, no refresh token storage.
export class TuyaReadOnly{
  private access:{value:string;expiresAt:number}|null=null;
  private inventory:{at:number;value:TuyaDevice[]}|null=null;
  private states=new Map<string,{at:number;value:TuyaState}>();
  constructor(private configFile:string|undefined,private fetcher:typeof fetch=fetch,private now:()=>number=Date.now){}
  configured(){return !!this.configFile;}
  private config(){
    if(!this.configFile)throw Error('TUYA_AUTH_BLOCKED');
    if(!path.isAbsolute(this.configFile))throw Error('TUYA_CONFIG_UNSAFE');
    let stat:ReturnType<typeof lstatSync>;
    try{stat=lstatSync(this.configFile);}catch(e){throw Error('TUYA_CONFIG_MISSING',{cause:e});}
    if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('TUYA_CONFIG_UNSAFE');
    return configSchema.parse(JSON.parse(readFileSync(this.configFile,'utf8')));
  }
  private async get(path:string,accessToken?:string){
    const config=this.config(),origin=origins[config.region];
    if(!path.startsWith('/v1.0/')||path.includes('..'))throw Error('TUYA_PATH_NOT_ALLOWED');
    const url=new URL(path,origin);
    if(url.origin!==origin)throw Error('TUYA_PATH_NOT_ALLOWED');
    const t=String(this.now()),nonce=randomUUID().replaceAll('-','');
    const contentHash=createHash('sha256').update('').digest('hex');
    const stringToSign=`GET\n${contentHash}\n\n${url.pathname}${url.search}`;
    const signature=createHmac('sha256',config.clientSecret).update(`${config.clientId}${accessToken??''}${t}${nonce}${stringToSign}`).digest('hex').toUpperCase();
    let response:Response;
    try{response=await this.fetcher(url,{method:'GET',headers:{client_id:config.clientId,t,nonce,sign_method:'HMAC-SHA256',sign:signature,...(accessToken?{access_token:accessToken}:{})},redirect:'error',signal:AbortSignal.timeout(5000)});}
    catch{throw Error('TUYA_UNAVAILABLE');}
    if(response.status===401||response.status===403)throw Error('TUYA_AUTH_REQUIRED');
    if(response.status===429)throw Error('TUYA_RATE_LIMITED');
    if(!response.ok)throw Error('TUYA_UNAVAILABLE');
    const raw:unknown=await response.json();
    if(!z.object({success:z.literal(true)}).safeParse(raw).success)throw Error('TUYA_API_REJECTED');
    return raw;
  }
  private async token(){
    if(this.access&&this.now()<this.access.expiresAt)return this.access.value;
    const data=tokenSchema.parse(await this.get('/v1.0/token?grant_type=1'));
    this.access={value:data.result.access_token,expiresAt:this.now()+Math.max(0,data.result.expire_time-60)*1000};
    return this.access.value;
  }
  async discover():Promise<TuyaDevice[]>{
    if(this.inventory&&this.now()-this.inventory.at<20_000)return this.inventory.value;
    const uid=encodeURIComponent(this.config().uid),token=await this.token(),found:TuyaDevice[]=[];
    for(let page=1;page<=5;page++){
      const data=deviceListSchema.parse(await this.get(`/v1.0/users/${uid}/devices?page_no=${page}&page_size=50`,token));
      found.push(...data.result);
      if(data.result.length<50){this.inventory={at:this.now(),value:found};return found;}
    }
    throw Error('TUYA_DISCOVERY_LIMIT');
  }
  async state(deviceId:string):Promise<TuyaState>{
    const id=deviceSchema.shape.id.parse(deviceId),cached=this.states.get(id);
    if(cached&&this.now()-cached.at<10_000)return cached.value;
    const data=deviceDetailSchema.parse(await this.get(`/v1.0/devices/${id}`,await this.token()));
    if(data.result.id!==id)throw Error('TUYA_ID_MISMATCH');
    const switchStatus=switchCode(data.result);
    const state=data.result.online&&switchStatus?(switchStatus.value?'on':'off'):'unavailable';
    const seconds=data.result.update_time;
    const observedAt=seconds&&seconds<8_640_000_000_000?new Date(seconds*1000).toISOString():null;
    const result:TuyaState={deviceId:id,state,observedAt,source:'tuya'};
    this.states.set(id,{at:this.now(),value:result});
    return result;
  }
}

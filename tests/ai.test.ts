import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import request from 'supertest';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/app.ts';
import {configuredAIProvider,type AIContext,type AIProvider} from '../server/ai.ts';

const origin='http://127.0.0.1:4198',password='synthetic-ai-password-42';
let root:string,service:ReturnType<typeof createApp>,cookie:string;
const context:AIContext={home:{id:'test',name:'Test',revision:1,rooms:[],scenes:[],objects:[]},devices:{mode:'unconfigured',connection:'unconfigured',entities:[]},recentEvents:[]};
const providerResult={reply:'Drita është e fikur. Mund ta ndez pas konfirmimit.',navigation:{type:'object' as const,targetId:'light'},commands:[{objectId:'light',action:'turn_on' as const,brightness:null,reason:'Kërkesë e qartë për dritën.'},{objectId:'invented',action:'turn_on' as const,brightness:null,reason:'Duhet hequr.'}],inventory:[],limitations:[]};
const respond=vi.fn<AIProvider['respond']>();
const provider:AIProvider={id:'synthetic-ai',label:'Synthetic AI test',destination:'in-process fixture',model:'synthetic-model',respond};

const get=(url:string,session=cookie)=>request(service.app).get(`/api/v1${url}`).set('Host','127.0.0.1:4198').set('Cookie',session);
const post=(url:string,body:unknown,session=cookie)=>request(service.app).post(`/api/v1${url}`).set('Host','127.0.0.1:4198').set('Origin',origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie',session).send(body as object);

beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'redionhome-ai-'));respond.mockReset();respond.mockResolvedValue(providerResult);
 service=createApp({root,origin,password,production:true,aiProvider:provider,aiTimeoutMs:500});
 cookie=(await post('/login',{password},'')).headers['set-cookie'][0].split(';')[0];
});
afterEach(()=>{service.store.close();rmSync(root,{recursive:true,force:true});vi.restoreAllMocks();});

describe('owner AI boundary',()=>{
 it('is owner-only, reports configuration without a secret and never executes a proposal',async()=>{
  expect((await get('/ai/status','')).status).toBe(401);
  const status=await get('/ai/status');expect(status.body).toMatchObject({enabled:true,provider:'synthetic-ai',model:'synthetic-model'});expect(JSON.stringify(status.body)).not.toContain('password');
  const before=await get('/devices'),reply=await post('/ai/chat',{message:'Ndiz dritën',history:[]});
  expect(reply.status).toBe(200);expect(reply.body.commands).toHaveLength(1);expect(reply.body.commands[0].objectId).toBe('light');expect(reply.body.limitations[0]).toContain('invented');
  const after=await get('/devices');expect(before.body.entities[0].state).toBe('off');expect(after.body.entities[0].state).toBe('off');
  expect((await post('/commands',{objectId:'light',action:'turn_on'})).body.entities[0].state).toBe('on');
 });

 it('passes only current registered context and bounded conversation to the provider',async()=>{
  await post('/ai/chat',{message:'Ku është rafti?',history:[{role:'user',text:'Përshëndetje'}]});
  const input=respond.mock.calls[0][0];expect(input.message).toBe('Ku është rafti?');expect(input.history).toEqual([{role:'user',text:'Përshëndetje'}]);expect(input.context.home.objects.some(object=>object.id==='shelf')).toBe(true);expect(input.context.devices.entities.some(entity=>entity.bindingId==='demo-light')).toBe(true);
 });

 it('requires explicit photo consent and keeps confirmed inventory separate from home configuration',async()=>{
  const photoDir=path.join(root,'media','private-fridge');mkdirSync(photoDir,{recursive:true});writeFileSync(path.join(photoDir,'manifest.json'),JSON.stringify({kind:'photo'}));writeFileSync(path.join(photoDir,'preview.jpg'),'sanitized-photo');
  expect((await post('/ai/chat',{message:'Çfarë ka?',photoMediaId:'private-fridge'})).status).toBe(400);expect(respond).not.toHaveBeenCalled();
  respond.mockResolvedValueOnce({...providerResult,commands:[],inventory:[{name:'Qumësht',quantity:'1 shishe',location:'Rafti i sipërm',confidence:'medium'}]});
  const revision=service.store.home().revision,result=await post('/ai/chat',{message:'Propozo inventarin',photoMediaId:'private-fridge',photoConsent:true});
  expect(result.status).toBe(200);expect(result.body.inventorySuggestionId).toBeTypeOf('string');expect(service.store.home().revision).toBe(revision);expect(respond.mock.calls[0][0].photo?.toString()).toBe('sanitized-photo');
  const confirmation=await post('/ai/inventory-confirm',{suggestionId:result.body.inventorySuggestionId,expectedRevision:revision,confirmed:true,items:result.body.inventory});expect(confirmation.status).toBe(200);expect(service.store.home().revision).toBe(revision);
 });
});

it('OpenAI adapter uses fixed endpoint, no storage and one strict bounded planner function',async()=>{
 const oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.OPENAI_MODEL;process.env.OPENAI_API_KEY='synthetic-openai-key';process.env.OPENAI_MODEL='synthetic-economy-model';
 try{
  const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({status:'completed',output:[{type:'function_call',name:'plan_home_request',arguments:JSON.stringify({...providerResult,commands:providerResult.commands.slice(0,1),targetResolution:'exact',ambient:null})}]}),{status:200}));
  const configured=configuredAIProvider()!;const result=await configured.respond({message:'Test',history:[],context,signal:new AbortController().signal});expect(result.reply).toContain('Drita');
  const [url,options]=network.mock.calls[0];expect(url).toBe('https://api.openai.com/v1/responses');expect(options?.redirect).toBe('error');expect((options?.headers as Record<string,string>).Authorization).toBe('Bearer synthetic-openai-key');
  const body=JSON.parse(String(options?.body));expect(body.store).toBe(false);expect(body.tools).toHaveLength(1);expect(body.tools[0]).toMatchObject({type:'function',name:'plan_home_request',strict:true});expect(body.tools[0].parameters.additionalProperties).toBe(false);expect(body.parallel_tool_calls).toBe(false);expect(body.tool_choice).toEqual({type:'function',name:'plan_home_request'});
 }finally{if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=oldModel;}
});

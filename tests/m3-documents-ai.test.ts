import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import request from 'supertest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import {createApp} from '../server/app.ts';
import {importDocument,imageOnlyPdf} from '../server/documents.ts';
import {importObjectMedia} from '../server/object-media.ts';
import type {PhotoSuggestionProvider} from '../shared/photo-assistant.ts';
import {configuredPhotoProvider} from '../server/photo-assistant.ts';
import {createShowroomApp} from '../server/showroom.ts';
import {exportPublication} from '../server/export.ts';
const origin='http://127.0.0.1:4193',password='synthetic-m3-doc-ai-password';
let root:string,service:ReturnType<typeof createApp>,owner:string;
const suggestion={name:'Llambë',category:'Ndriçim',description:'Një llambë e gjelbër.'};
const suggest=vi.fn<PhotoSuggestionProvider['suggest']>();
const provider:PhotoSuggestionProvider={id:'synthetic-test',label:'Synthetic test only',destination:'local injected function',suggest};
const get=(url:string,cookie=owner)=>request(service.app).get(`/api/v1${url}`).set('Host','127.0.0.1:4193').set('Cookie',cookie);
const post=(url:string,body:unknown,cookie=owner)=>request(service.app).post(`/api/v1${url}`).set('Host','127.0.0.1:4193').set('Origin',origin).set('Cookie',cookie).send(body as object);
const save=(body:unknown)=>request(service.app).put('/api/v1/home').set('Host','127.0.0.1:4193').set('Origin',origin).set('Cookie',owner).send(body as object);
beforeEach(async()=>{
 root=mkdtempSync(path.join(os.tmpdir(),'redionhome-doc-ai-'));suggest.mockReset();suggest.mockResolvedValue(suggestion);
 service=createApp({root,origin,password,production:true,photoProvider:provider,photoTimeoutMs:500});
 owner=(await post('/login',{password},'')).headers['set-cookie'][0].split(';')[0];
 const image=await sharp({create:{width:256,height:128,channels:3,background:'#3c7259'}}).jpeg().toBuffer();
 for(const id of ['atelier','studio']){const dir=path.join(root,'media',id);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'preview.jpg'),image);writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({id,width:2048,height:1024,levels:[{width:2048,cols:4,rows:2}]}));}
});
afterEach(()=>{service.store.close();rmSync(root,{recursive:true,force:true});vi.restoreAllMocks();});
async function uploadPhoto(){const bytes=await sharp({create:{width:256,height:256,channels:3,background:'#536848'}}).withExif({IFD0:{Copyright:'PRIVATE ORIGINAL'}}).jpeg().toBuffer();return (await importObjectMedia(bytes,root,'photo')).id;}
async function preparePublication(audience:'invited'|'public',mediaIds:string[]){const r=await post('/publications',{title:'Manual preview',audience,sceneIds:['atelier-view'],objectIds:['artwork'],mediaIds:['atelier',...mediaIds],expectedRevision:service.store.home().revision});expect(r.status).toBe(201);await post(`/publications/${r.body.id}/activate`,{approved:true});return r.body.id as string;}
it('PDF is flattened to a static image-only document, preserving private original bytes',async()=>{
 const jpeg=await sharp({create:{width:150,height:200,channels:3,background:'#304f37'}}).jpeg().toBuffer();
 const original=imageOnlyPdf([{jpeg,width:150,height:200}]);
 // Malicious OpenAction remains only in the immutable original. Poppler repairs xref offsets.
 const active=Buffer.from(original.toString('latin1').replace('/Pages 2 0 R','/Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>'),'latin1');
 const imported=await importDocument(active,root);expect(imported.mime).toBe('application/pdf');
 const dir=path.join(root,'media',imported.id);expect(readFileSync(path.join(dir,'original'))).toEqual(active);
 const flat=readFileSync(path.join(dir,'document.pdf'));expect(flat.toString('latin1')).not.toContain('/JavaScript');expect(flat.toString('latin1')).not.toContain('/OpenAction');
 const info=execFileSync('pdfinfo',[path.join(dir,'document.pdf')],{encoding:'utf8'});expect(info).toMatch(/Pages:\s+1/);expect(info).toMatch(/JavaScript:\s+no/);
});
it('text cannot execute or sniff HTML, malformed binaries leave no partial document',async()=>{
 const doc=await importDocument(Buffer.from('<script>alert(1)</script>'),root);
 const response=await get(`/media/${doc.id}/document.txt`);expect(response.status).toBe(200);expect(response.headers['content-type']).toContain('text/plain');expect(response.headers['content-disposition']).toContain('attachment');expect(response.headers['content-security-policy']).toContain('sandbox');expect(response.headers['x-content-type-options']).toBe('nosniff');
 await expect(importDocument(Buffer.from([0xff,0,0x9a]),root)).rejects.toThrow('INVALID_DOCUMENT');expect(existsSync(path.join(root,'media',doc.id,'original'))).toBe(true);
});
it('document identity survives edits/versioning and public snapshots contain only explicitly eligible documents',async()=>{
 const a=await importDocument(Buffer.from('Private manual'),root),b=await importDocument(Buffer.from('Invited manual'),root),c=await importDocument(Buffer.from('Public manual'),root);
 const home=service.store.home();home.scenes[0].visibility='public';const object=home.objects.find(o=>o.id==='artwork')!;object.visibility='public';object.documents=[{id:'stable-private',mediaId:a.id,title:'Private',mime:a.mime,visibility:'private'},{id:'stable-invited',mediaId:b.id,title:'Invited',mime:b.mime,visibility:'invited'},{id:'stable-public',mediaId:c.id,title:'Public',mime:c.mime,visibility:'public'}];
 expect((await save(home)).status).toBe(200);
 const next=service.store.home();next.objects.find(o=>o.id==='artwork')!.documents![2].title='Edited public';expect((await save(next)).status).toBe(200);expect(service.store.home().objects.find(o=>o.id==='artwork')!.documents![2].id).toBe('stable-public');
 const id=await preparePublication('public',[a.id,b.id,c.id]);const tour=(await get(`/tours/${id}/home`,'')).body;
 expect(tour.objects[0].documents).toHaveLength(1);expect(tour.objects[0].documents[0].title).toBe('Edited public');expect(JSON.stringify(tour)).not.toContain(a.id);expect(JSON.stringify(tour)).not.toContain('stable-public');
 const m=tour.objects[0].documents[0].mediaId;expect((await get(`/tours/${id}/media/${m}/document.txt`,'')).text).toBe('Public manual');expect((await get(`/tours/${id}/media/${a.id}/document.txt`,'')).status).toBe(404);expect((await get(`/media/${c.id}/document.txt`,'')).status).toBe(401);
 const artifact=path.join(root,'artifact'),client=path.join(root,'client');mkdirSync(client);writeFileSync(path.join(client,'index.html'),'showroom');exportPublication(root,id,artifact,client);const show=createShowroomApp(artifact,origin);expect((await request(show).get(`/api/v1/tours/${id}/media/${m}/document.txt`).set('Host','127.0.0.1:4193')).text).toBe('Public manual');
 const invitedId=await preparePublication('invited',[a.id,b.id,c.id]);const invitation=await post('/invitations',{label:'Guest',role:'invited_guest',expiresHours:1,maxSessions:1,grant:{publicationId:invitedId}});const redeemed=await post('/invitations/redeem',{token:invitation.body.token},'');const guest=redeemed.headers['set-cookie'][0].split(';')[0];
 const invited=(await get(`/tours/${invitedId}/home`,guest)).body;expect(invited.objects[0].documents).toHaveLength(2);expect((await get(`/media/${a.id}/document.txt`,guest)).status).toBe(403);expect((await post('/document-uploads',{},guest)).status).toBe(403);await post(`/access/${invitation.body.id}/revoke`,{});expect((await get(`/tours/${invitedId}/media/${invited.objects[0].documents[0].mediaId}/document.txt`,guest)).status).toBe(403);
});
it('AI cannot see a photo without explicit consent or produce side-effect fields',async()=>{
 const id=await uploadPhoto(),revision=service.store.home().revision;
 expect((await post('/photo-suggestions',{photoMediaId:id,expectedRevision:revision})).status).toBe(400);expect(suggest).not.toHaveBeenCalled();
 expect((await post('/photo-suggestions',{photoMediaId:id,expectedRevision:revision,consent:false})).status).toBe(400);
 expect((await post('/photo-suggestions',{photoMediaId:'atelier',expectedRevision:revision,consent:true})).status).toBe(400);expect(suggest).not.toHaveBeenCalled();
 suggest.mockResolvedValueOnce(Object.assign({...suggestion},{command:'turn_on'}));expect((await post('/photo-suggestions',{photoMediaId:id,expectedRevision:revision,consent:true})).status).toBe(422);expect(service.store.home().revision).toBe(revision);
});
it('AI proposal, correction and confirmation only affect the draft until ordinary versioned save',async()=>{
 const id=await uploadPhoto(),before=service.store.home(),r=await post('/photo-suggestions',{photoMediaId:id,expectedRevision:before.revision,consent:true});expect(r.status).toBe(201);expect(service.store.home()).toEqual(before);
 expect((await sharp(suggest.mock.calls[0][0]).metadata()).exif).toBeUndefined();
 const unconfirmed=structuredClone(before);unconfirmed.objects[0].photoSuggestionId=r.body.id;expect((await save(unconfirmed)).status).toBe(400);
 const corrected={...suggestion,name:'Emri im'};const confirmation=await post('/photo-suggestions/confirm',{suggestionId:r.body.id,expectedRevision:before.revision,confirmed:true,corrected});expect(confirmation.status).toBe(200);expect(service.store.home()).toEqual(before);
 const next=structuredClone(before);Object.assign(next.objects[0],confirmation.body);expect((await save(next)).status).toBe(200);expect(service.store.home().objects[0].name).toBe('Emri im');
 const row=service.store.db.prepare('SELECT confirmed_json FROM photo_suggestions WHERE id=?').get(r.body.id) as {confirmed_json:string};expect(JSON.parse(row.confirmed_json)).toEqual(corrected);
});
it('AI refusal, timeout and concurrent revision conflict leave the home untouched by AI',async()=>{
 const id=await uploadPhoto(),before=service.store.home(),body={photoMediaId:id,expectedRevision:before.revision,consent:true};
 suggest.mockRejectedValueOnce(Error('AI_REFUSED'));expect((await post('/photo-suggestions',body)).body.error).toBe('AI_REFUSED');expect(service.store.home()).toEqual(before);
 suggest.mockImplementationOnce((_photo,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))));expect((await post('/photo-suggestions',body)).body.error).toBe('AI_TIMEOUT');expect(service.store.home()).toEqual(before);
 suggest.mockImplementationOnce(async()=>{service.store.save({...before,name:'Concurrent owner edit'},'test');return suggestion;});expect((await post('/photo-suggestions',body)).status).toBe(409);expect(service.store.home().name).toBe('Concurrent owner edit');expect((service.store.db.prepare('SELECT count(*) as n FROM photo_suggestions').get() as {n:number}).n).toBe(0);
});
it('unconfigured AI stays disabled and unauthenticated users cannot invoke any photo assistant endpoint',async()=>{
 const previousKey=process.env.PHOTO_AI_KEY_FILE,previousModel=process.env.PHOTO_AI_MODEL;delete process.env.PHOTO_AI_KEY_FILE;delete process.env.PHOTO_AI_MODEL;expect(configuredPhotoProvider()).toBeUndefined();if(previousKey!==undefined)process.env.PHOTO_AI_KEY_FILE=previousKey;if(previousModel!==undefined)process.env.PHOTO_AI_MODEL=previousModel;
 expect((await get('/photo-assistant','')).status).toBe(401);for(const p of ['/photo-suggestions','/photo-suggestions/confirm'])expect((await post(p,{},'')).status).toBe(401);
});
it('optional adapter uses the fixed image-only structured-output contract without real network calls',async()=>{
 const keyFile=path.join(root,'synthetic-key');writeFileSync(keyFile,'synthetic-test-key',{mode:0o600});
 const oldKey=process.env.PHOTO_AI_KEY_FILE,oldModel=process.env.PHOTO_AI_MODEL;
 process.env.PHOTO_AI_KEY_FILE=keyFile;process.env.PHOTO_AI_MODEL='synthetic-vision-model';
 try{
  const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(suggestion)}]}]}),{status:200}));
  const p=configuredPhotoProvider()!;const image=Buffer.from('synthetic-photo');expect(await p.suggest(image,new AbortController().signal)).toEqual(suggestion);
  const [url,options]=network.mock.calls[0];expect(url).toBe('https://api.openai.com/v1/responses');expect(options?.redirect).toBe('error');
  const body=JSON.parse(String(options?.body));expect(body.store).toBe(false);expect(body.tools).toBeUndefined();expect(body.text.format.type).toBe('json_schema');expect(body.text.format.schema.additionalProperties).toBe(false);expect(body.input[0].content[1].image_url).toBe(`data:image/jpeg;base64,${image.toString('base64')}`);
  network.mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',output:[{content:[{type:'refusal'}]}]})));await expect(p.suggest(image,new AbortController().signal)).rejects.toThrow('AI_REFUSED');
 }finally{if(oldKey===undefined)delete process.env.PHOTO_AI_KEY_FILE;else process.env.PHOTO_AI_KEY_FILE=oldKey;if(oldModel===undefined)delete process.env.PHOTO_AI_MODEL;else process.env.PHOTO_AI_MODEL=oldModel;}
});

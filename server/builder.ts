import express, { type Express, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { importPanorama } from './media.ts';
import type { Store } from './store.ts';
import { roomImportSchema, type PanoramaImportStatus } from '../shared/builder.ts';
import { z } from 'zod';
import {homeSchema,idSchema} from '../shared/model.ts';

export function mountBuilder(app: Express, store: Store, root: string, owner: RequestHandler) {
  app.get('/api/v1/homes',owner,(_req,res)=>{
    const rows=store.db.prepare(`SELECT r.document FROM revisions r JOIN (SELECT json_extract(document,'$.id') AS id,MAX(revision) AS revision FROM revisions GROUP BY id) latest ON latest.revision=r.revision ORDER BY r.revision DESC`).all() as {document:string}[];
    res.json(rows.map(row=>{const h=JSON.parse(row.document);return {id:h.id,name:h.name,revision:h.revision};}));
  });
  app.post('/api/v1/homes/:id/activate',owner,(req,res)=>{
    const id=idSchema.parse(req.params.id),{expectedRevision}=z.object({expectedRevision:z.number().int().positive()}).strict().parse(req.body);
    const row=store.db.prepare(`SELECT document FROM revisions WHERE json_extract(document,'$.id')=? ORDER BY revision DESC LIMIT 1`).get(id) as {document:string}|undefined;
    if(!row){res.status(404).json({error:'HOME_NOT_FOUND'});return;}
    const home=store.save({...homeSchema.parse(JSON.parse(row.document)),revision:expectedRevision},'owner');
    res.json({home,sceneId:home.scenes[0].id});
  });
  const jobs = new Map<string, { result: PanoramaImportStatus; controller: AbortController; started: number }>();
  app.post('/api/v1/panorama-imports', owner, express.raw({type:'application/octet-stream',limit:'80mb'}), (req,res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({error:'INVALID_PANORAMA'}); return; }
    if ([...jobs.values()].some(j=>j.result.status==='processing')) { res.status(409).json({error:'IMPORT_BUSY'}); return; }
    for (const [id,j] of jobs) if (Date.now()-j.started>3600000) jobs.delete(id);
    if (jobs.size >= 100) { res.status(429).json({error:'IMPORT_LIMIT'}); return; }
    const id = randomUUID(), mediaId = randomUUID(), source=path.join(root, `.panorama-${id}`), controller=new AbortController();
    const started=Date.now();
    const result: PanoramaImportStatus={id,status:'processing',progress:0,elapsedMs:0};
    writeFileSync(source,req.body,{mode:0o600,flag:'wx'});
    jobs.set(id,{result,controller,started});
    res.status(202).json(result);
    const timeout=setTimeout(()=>controller.abort(),120000);
    void importPanorama(source,root,mediaId,{signal:controller.signal,onProgress:p=>{result.progress=p;result.elapsedMs=Date.now()-started;}})
      .then(()=>{result.status='ready';result.mediaId=mediaId;store.audit('owner','panorama.import',mediaId);})
      .catch((error: unknown)=>{
        result.status=controller.signal.aborted?'cancelled':'failed';
        const message=error instanceof Error?error.message:'';
        result.error=message==='PANORAMA_ORIENTATION'?'PANORAMA_ORIENTATION':message==='PANORAMA_FORMAT'?'PANORAMA_FORMAT':'INVALID_PANORAMA';
      }).finally(()=>{clearTimeout(timeout);result.elapsedMs=Date.now()-started;rmSync(source,{force:true});});
  });
  app.get('/api/v1/panorama-imports/:id',owner,(req,res)=>{
    const job=jobs.get(String(req.params.id));
    if(!job){res.status(404).json({error:'IMPORT_EXPIRED'});return;}
    res.json(job.result);
  });
  app.delete('/api/v1/panorama-imports/:id',owner,(req,res)=>{
    const job=jobs.get(String(req.params.id));
    if(!job){res.status(404).json({error:'IMPORT_EXPIRED'});return;}
    if(job.result.status==='processing')job.controller.abort();
    // Completed originals are immutable, even if the user leaves without saving a room.
    res.status(204).end();
  });
  app.get('/api/v1/panoramas',owner,(_req,res)=>{
    // The existing private media catalogue provides IDs; inspect only validated manifests here.
    const home=store.home();
    const rows=(existsSync(path.join(root,'media'))?readdirSync(path.join(root,'media')):[]).filter(id=>/^[\w-]+$/.test(id)).flatMap(id=>{
      try { const m=JSON.parse(readFileSync(path.join(root,'media',id,'manifest.json'),'utf8'));
        return !m.kind&&m.levels?.length?[{id,name:home.scenes.find(s=>s.mediaId===id)?.name??'Panoramë e importuar',width:m.width,height:m.height}]:[];
      } catch { return []; }
    });
    res.json(rows);
  });
  app.post('/api/v1/rooms',owner,(req,res)=>{
    const input=roomImportSchema.parse(req.body), home=store.home();
    if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    let manifest;
    try{manifest=JSON.parse(readFileSync(path.join(root,'media',input.mediaId,'manifest.json'),'utf8'));}catch{res.status(400).json({error:'UNKNOWN_MEDIA'});return;}
    if(manifest.kind || !manifest.levels?.length || Math.abs(manifest.width/manifest.height-2)>0.02){res.status(400).json({error:'INVALID_PANORAMA'});return;}
    if(input.replaceSceneId&&!home.scenes.some(s=>s.id===input.replaceSceneId)){res.status(404).json({error:'SCENE_NOT_FOUND'});return;}
    const roomId=randomUUID(),sceneId=input.replaceSceneId??randomUUID();
    const next=input.replaceSceneId?{
      ...home,name:input.homeName??home.name,scenes:home.scenes.map(s=>s.id===sceneId?{...s,name:input.name,mediaId:input.mediaId,initial:input.initial}:s),
      rooms:home.rooms.map(r=>r.id===home.scenes.find(s=>s.id===sceneId)!.roomId?{...r,name:input.name}:r),
    }:{
      ...home,name:input.homeName??home.name,
      rooms:[...home.rooms,{id:roomId,floorId:home.floors[0].id,name:input.name}],
      scenes:[...home.scenes,{id:sceneId,roomId,name:input.name,mediaId:input.mediaId,initial:input.initial,hotspots:[],visibility:'private' as const}],
    };
    res.status(201).json({home:store.save(next,'owner'),sceneId});
  });
  app.post('/api/v1/homes',owner,(req,res)=>{
    const input=roomImportSchema.omit({replaceSceneId:true}).required({homeName:true}).parse(req.body);
    if(store.home().revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    let m;try{m=JSON.parse(readFileSync(path.join(root,'media',input.mediaId,'manifest.json'),'utf8'));}catch{res.status(400).json({error:'UNKNOWN_MEDIA'});return;}
    if(m.kind||!m.levels?.length||Math.abs(m.width/m.height-2)>0.02){res.status(400).json({error:'INVALID_PANORAMA'});return;}
    const homeId=randomUUID(),floorId=randomUUID(),roomId=randomUUID(),sceneId=randomUUID();
    const home=store.save(homeSchema.parse({schemaVersion:1,id:homeId,name:input.homeName,revision:input.expectedRevision,demo:false,floors:[{id:floorId,name:'Kati 1'}],rooms:[{id:roomId,floorId,name:input.name}],scenes:[{id:sceneId,roomId,name:input.name,mediaId:input.mediaId,initial:input.initial,visibility:'private',hotspots:[]}],objects:[]}),'owner');
    res.status(201).json({home,sceneId});
  });
}

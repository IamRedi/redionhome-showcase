// Independent read-only showroom. Deliberately imports no Store, auth,
// provider or Home Runtime controller. Never point it at a private DATA_DIR.
import express from 'express';
import path from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {homeSchema} from '../shared/model.ts';
export function createShowroomApp(artifact:string,origin:string){
 const home=homeSchema.parse(JSON.parse(readFileSync(path.join(artifact,'tour','home.json'),'utf8')));
 if(home.objects.some(o=>o.provider||o.permissions||o.actions.some(a=>!['info','portal','demo','link','app'].includes(a.type))))throw Error('UNSAFE_ARTIFACT');
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{
  res.set({'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
  if(req.headers.host!==new URL(origin).host){res.status(403).end();return;}
  if(!['GET','HEAD'].includes(req.method)){res.status(405).end();return;}
  next();
 });
 app.get(`/api/v1/tours/${home.id}/home`,(_req,res)=>res.json(home));
 app.get(`/api/v1/tours/${home.id}/media/:media/:file`,(req,res)=>{
  const media=String(req.params.media),file=String(req.params.file);
  if(!/^media-\d+$/.test(media)||!/^(manifest|preview\.jpg|video\.mp4|document\.(pdf|txt)|\d+-\d+-\d+\.jpg)$/.test(file)){res.status(404).end();return;}
  const filename=path.resolve(artifact,'tour','media',media,file==='manifest'?'manifest.json':file);
  if(!existsSync(filename)){res.status(404).end();return;}
  if(/^document\./.test(file))res.set({'Content-Type':file.endsWith('.pdf')?'application/pdf':'text/plain','Content-Disposition':`attachment; filename="${file}"`,'Content-Security-Policy':"sandbox; default-src 'none'"});
  res.sendFile(filename,{dotfiles:'allow'});
 });
 app.use('/api',(_req,res)=>{res.status(404).end();});
 app.get('/',(_req,res)=>res.redirect(`/tour/${home.id}`));
 app.use(express.static(path.resolve(artifact,'client'),{index:false,dotfiles:'deny'}));
 app.get(`/tour/${home.id}`,(_req,res)=>res.sendFile(path.resolve(artifact,'client','index.html')));
 app.use((_req,res)=>{res.status(404).end();});
 return app;
}

import { useEffect, useRef, useState } from 'react';
import type { Home, Position, Scene } from '../shared/model.ts';
import type { PanoramaImportStatus } from '../shared/builder.ts';
import { api, ApiError, errorText, uploadBinary } from './api.ts';
import {roomDraftSchema} from '../shared/drafts.ts';
import { Dialog } from './Dialog.tsx';
import { Panorama, type PanoramaHandle } from './Panorama.tsx';

type Choice={id:string;name:string;width:number;height:number};
export function HomeBuilder({home,onClose,onSave}:{home:Home;onClose:()=>void;onSave:(home:Home,sceneId:string)=>void}){
 const [mode,setMode]=useState<'new'|'replace'|'home'>('new'),[target,setTarget]=useState(home.scenes[0].id),[name,setName]=useState(''),[homeName,setHomeName]=useState(home.name),[homes,setHomes]=useState<{id:string;name:string}[]>([]);
 const [choices,setChoices]=useState<Choice[]>([]),[media,setMedia]=useState(''),[file,setFile]=useState<File>(),[job,setJob]=useState<PanoramaImportStatus>(),[progress,setProgress]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false),[initial,setInitial]=useState<Position>({yaw:0,pitch:0});
 const preview=useRef<PanoramaHandle>(null),controller=useRef<AbortController|null>(null),jobId=useRef(''),mounted=useRef(true);
 const key=`redionhome-room-draft:${home.id}`;
 const [recovery,setRecovery]=useState<string|null>(()=>sessionStorage.getItem(key));
 const draftChanged=!!name||!!media||homeName!==home.name;
 const refresh=()=>void api<Choice[]>('/panoramas').then(setChoices).catch(e=>setError(errorText(e)));
 useEffect(()=>{mounted.current=true;refresh();void api<typeof homes>('/homes').then(setHomes).catch(e=>setError(errorText(e)));return()=>{mounted.current=false;controller.current?.abort();if(jobId.current)void api(`/panorama-imports/${jobId.current}`,'DELETE').catch(()=>undefined);};},[]);
 useEffect(()=>{if(draftChanged)sessionStorage.setItem(key,JSON.stringify({mode,target,name,homeName,media,initial}));},[mode,target,name,homeName,media,initial]);
 useEffect(()=>{
  const protect=(e:BeforeUnloadEvent)=>{if(draftChanged||busy){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);
 },[draftChanged,busy]);
 const cancel=()=>{controller.current?.abort();if(jobId.current)void api(`/panorama-imports/${jobId.current}`,'DELETE').catch(()=>undefined);};
 const upload=async(selected:File)=>{
  setFile(selected);setBusy(true);setError('');setMedia('');setReady(false);setJob(undefined);setProgress(0);
  const control=new AbortController();controller.current=control;jobId.current='';
  try{
   let result=await uploadBinary<PanoramaImportStatus>(selected,'/panorama-imports',control.signal,setProgress);jobId.current=result.id;
   while(result.status==='processing'){
    if(control.signal.aborted)throw new DOMException('Cancelled','AbortError');
    if(mounted.current)setJob(result);
    await new Promise<void>(resolve=>setTimeout(resolve,250));
    result=await api<PanoramaImportStatus>(`/panorama-imports/${result.id}`);
   }
   if(control.signal.aborted)throw new DOMException('Cancelled','AbortError');
   if(result.status==='ready'&&result.mediaId){if(mounted.current){setMedia(result.mediaId);setJob(result);refresh();}}
   else throw new ApiError(400,result.error??'INVALID_PANORAMA');
  }catch(e){if(mounted.current)setError(e instanceof DOMException&&e.name==='AbortError'?'Importi u anulua. Drafti mbeti; mund të provoni përsëri.':errorText(e));}
  finally{if(mounted.current)setBusy(false);controller.current=null;}
 };
 const scene:Scene={id:`preview-${media}`,roomId:'preview',name:name||'Preview 360°',mediaId:media,initial,hotspots:[]};
 const close=()=>{if((draftChanged||busy)&&!window.confirm('Të mbyllet? Drafti ruhet në këtë sesion; skedari mund të kërkojë rizgjedhje.'))return;cancel();onClose();};
 return <Dialog title="Shtëpia & dhomat" eyebrow="NDËRTO NGA TELEFONI" onClose={close}>
  <div className="editor-form builder-form">
   <p className="muted">Emërtoni hapësirën, shtoni dhomën dhe zgjidhni një panoramë 360°. Asgjë nuk ruhet në shtëpi para konfirmimit.</p>
   {recovery&&<div className="notice"><span>Ka një draft dhome të paruajtur.</span><button type="button" onClick={()=>{try{const d=roomDraftSchema.parse(JSON.parse(recovery));setMode(d.mode);setTarget(d.target);setName(d.name);setHomeName(d.homeName);setMedia(d.media);setInitial(d.initial);}catch{setError('Drafti nuk u lexua. Zgjidhni përsëri panoramën.');}setRecovery(null);}}>Rikupero draftin</button><button type="button" onClick={()=>{sessionStorage.removeItem(key);setRecovery(null);}}>Hidh draftin</button></div>}
   <label>Emri i hapësirës<input value={homeName} maxLength={120} onChange={e=>setHomeName(e.target.value)}/></label>
   <label>Çfarë dëshironi të bëni?<select value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setName(e.target.value==='replace'?home.scenes.find(s=>s.id===target)!.name:'');setHomeName(e.target.value==='home'?'':home.name);}}><option value="new">Shto dhomë</option><option value="replace">Zëvendëso panoramën e një dhome</option><option value="home">Krijo shtëpi / hapësirë të re</option></select></label>
   {mode==='home'&&<p className="notice">Hapësira e re fillon me dhomën e parë. Hapësira aktuale, origjinalet dhe historia ruhen; mund ta hapni përsëri më poshtë.</p>}
   {mode==='replace'&&<><label>Dhoma ekzistuese<select value={target} onChange={e=>{setTarget(e.target.value);setName(home.scenes.find(s=>s.id===e.target.value)!.name);}}>{home.scenes.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><p className="notice">Objektet, hotspot-et dhe versionet ruhen. Kontrolloni pozicionet pas zëvendësimit.</p></>}
   <label>Emri i dhomës<input aria-label="Emri i dhomës" value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder="P.sh. Studio"/></label>
   <h3>1 · Zgjidh panoramën 360°</h3>
   <label className="secondary capture-label">Galeria / Files<input aria-label="Importo panoramë 360°" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value='';}}/></label>
   <p className="muted">JPEG, PNG ose WebP · 2:1 · të paktën 2048 px · deri 80 MB. Kamera normale nuk krijon automatikisht panoramë sferike; importoni eksportin 360° nga aplikacioni ose kamera juaj.</p>
   {busy&&<div role="status"><label>{job?'Përgatitja e tiles':'Ngarkimi'}<progress aria-label={job?'Përgatitja e tiles':'Ngarkimi i panoramës'} value={job?.progress??progress} max={100}/></label><span>{job?.progress??progress}%</span><button type="button" onClick={cancel}>Anulo importin</button></div>}
   {error&&<div role="alert" className="inline-error">{error}{file&&!busy&&<button type="button" onClick={()=>void upload(file)}>Riprovo importin</button>}</div>}
   <label>Ose zgjidh një panoramë të importuar<select aria-label="Panorama të importuara" disabled={busy} value={media} onChange={e=>{setReady(false);setMedia(e.target.value);}}><option value="">Zgjidhni…</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name} · {c.width}×{c.height}</option>)}</select></label>
   {media&&<><h3>2 · Kontrollo preview 360°</h3><div className="panorama-preview"><Panorama ref={preview} scene={scene} objects={[]} devices={null} role="owner" visible={false} placing={false} onSelect={()=>undefined} onQuickToggle={()=>undefined} onPlace={()=>undefined} onYaw={()=>undefined} onError={setError} onLoaded={()=>setReady(true)}/></div><p className="muted">Tërhiqni dhe bëni zoom. Kontrolloni vijën e bashkimit dhe drejtimin; raporti 2:1 nuk provon vetë që fotografia mbulon gjithë sferën.</p><button type="button" className="secondary" onClick={()=>setInitial(preview.current?.position()??initial)}>Përdor këtë kënd nisjeje</button></>}
   <button className="primary wide" disabled={busy||!ready||!media||!name.trim()||!homeName.trim()} onClick={()=>{
    setBusy(true);setError('');void api<{home:Home;sceneId:string}>(mode==='home'?'/homes':'/rooms','POST',{expectedRevision:home.revision,name,homeName,mediaId:media,initial,replaceSceneId:mode==='replace'?target:undefined}).then(r=>{sessionStorage.removeItem(key);onSave(r.home,r.sceneId);}).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));
   }}>Ruaj dhomën dhe shto objekte</button>
   {homes.length>1&&<details><summary>Hapësirat e mia</summary>{homes.map(h=><button className="secondary wide" key={h.id} disabled={busy||h.id===home.id} onClick={()=>{if(draftChanged&&!window.confirm('Të hapet hapësira tjetër duke ruajtur draftin aktual?'))return;setBusy(true);void api<{home:Home;sceneId:string}>(`/homes/${h.id}/activate`,'POST',{expectedRevision:home.revision}).then(r=>onSave(r.home,r.sceneId)).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));}}>{h.name}{h.id===home.id?' · aktive':''}</button>)}</details>}
  </div>
 </Dialog>;
}

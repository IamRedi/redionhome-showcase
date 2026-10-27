import { useEffect, useRef, useState } from 'react';
import type { HomeObject } from '../shared/model.ts';
import type { PhotoFields } from '../shared/photo-assistant.ts';
import { api, uploadBinary, mediaUrl, errorText } from './api.ts';
import {PhotoAssistant} from './PhotoAssistant.tsx';
import {objectKind,objectKindLabel} from './object-presentation.ts';
import {ExperienceFields} from './ExperienceFields.tsx';
export const objectKinds=Object.keys(objectKindLabel) as NonNullable<HomeObject['kind']>[];
const kindContextHint:Partial<Record<NonNullable<HomeObject['kind']>,string>>={
 light:'Paneli ditor tregon vetëm ON/OFF dhe ndriçimin që mbështet lidhja reale.',
 outlet:'Paneli ditor tregon vetëm kontrollin që mbështet lidhja reale.',
 tv:'Paneli tregon gjendjen live; telekomanda reale aktivizohet vetëm pas aftësive të raportuara dhe autorizimit tuaj.',
 shelf:'Paneli ditor tregon pamjen ballore, nivelet dhe sendet brenda.',
 fridge:'Paneli ditor tregon pamjen e çiftuar hap/mbyll.',
 piano:'Paneli hap përvojën Piano Core.',
 photo:'Galeria hapet fullscreen në modalitetin art.',
};
export function ObjectFields({ object, fields={}, bindingManaged=false, revision, onSuggest, onChange, onBusy }: {
 object?:HomeObject; fields?:Partial<HomeObject>; bindingManaged?:boolean; revision:number;
 onSuggest:(fields:PhotoFields&{photoSuggestionId:string})=>void;
 onChange:(fields:Partial<HomeObject>)=>void; onBusy:(busy:boolean)=>void;
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[media,setMedia]=useState<string[]>([]),[progress,setProgress]=useState(0),[retry,setRetry]=useState<{file:File;kind:'photo'|'video'|'document'}>();
 const latest=useRef({fields,object,onChange}),controller=useRef<AbortController|null>(null),mounted=useRef(true);latest.current={fields,object,onChange};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 const current={...object,...fields};
 const update=(patch:Partial<HomeObject>)=>latest.current.onChange({...latest.current.fields,...patch});
 const actions=current.actions??[{type:'info' as const}],demo=actions.find(a=>a.type==='demo'),link=actions.find(a=>a.type==='link');
 const mediaOptions=Array.from(new Set([current.mediaId,current.videoId,...(current.gallery??[]),current.experiences?.private?.mediaId,current.experiences?.private?.videoId,...(current.experiences?.private?.gallery??[]),current.experiences?.showroom?.mediaId,current.experiences?.showroom?.videoId,...(current.experiences?.showroom?.gallery??[]),...media].filter((id):id is string=>!!id)));
 const kind=current.kind??(object?objectKind(object):'generic');
 const simulations=kind==='piano'?['piano']:kind==='robot'?['robot']:kind==='fridge'?['fridge']:['generic','product'].includes(kind)?['piano','led-wall','robot','fridge']:[];
 if(demo&&!simulations.includes(demo.demo))simulations.push(demo.demo);
 const providerChoices=['light','outlet','switch','sensor','thermostat','cover','media','fan','valve','lock','tv','door'].includes(kind)?['mock','home-assistant','smartthings','tuya','matter','mqtt','vendor']:kind==='piano'?['piano-core']:kind==='printer'?['bambu-lab']:kind==='robot'?['hugo']:['generic','product'].includes(kind)?['mock','home-assistant','matter','mqtt','vendor','piano-core','led-wall','bambu-lab','hugo']:[];
 if(current.provider?.active&&!providerChoices.includes(current.provider.active))providerChoices.push(current.provider.active);
 const secondary=(type:string,next:HomeObject['actions'])=>update({actions:[...actions.filter(a=>a.type!==type),...next]});
 const upload=async(file:File|undefined,kind:'photo'|'video'|'document')=>{
  if(!file)return;const control=new AbortController();controller.current=control;setRetry({file,kind});setBusy(true);onBusy(true);setError('');setProgress(0);
  try{
   const imported=await uploadBinary<{id:string;kind:string;mime:'application/pdf'|'text/plain'}>(file,kind==='document'?'/document-uploads':`/uploads?kind=${kind}`,control.signal,setProgress);
   if(!mounted.current||control.signal.aborted)return;
   const now={...latest.current.object,...latest.current.fields};
   if(kind==='photo')update({gallery:[...(now.gallery??[]),imported.id]});
   else if(kind==='video')update({videoId:imported.id});
   else update({documents:[...(now.documents??[]),{id:crypto.randomUUID(),mediaId:imported.id,title:file.name.replace(/\.[^.]+$/,'').slice(0,120)||'Dokument',mime:imported.mime,visibility:'private'}]});
   setRetry(undefined);
  }catch(e){if(mounted.current)setError(control.signal.aborted?'Ngarkimi u anulua. Drafti mbeti; zgjidhni Riprovo kur të jeni gati.':errorText(e));}
  finally{if(mounted.current){setBusy(false);onBusy(false);}controller.current=null;}
 };
 return <section className="object-fields">
  <div className="capture-actions"><label className="secondary capture-label">Kamera<input aria-label="Kamera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={e=>{void upload(e.target.files?.[0],'photo');e.target.value='';}}/></label><label className="secondary capture-label">Galeria<input aria-label="Galeria" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{void upload(e.target.files?.[0],'photo');e.target.value='';}}/></label><label className="secondary capture-label">Files<input aria-label="Files" type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy} onChange={e=>{void upload(e.target.files?.[0],'photo');e.target.value='';}}/></label></div><p className="muted">Zgjedhësi që hapet varet nga Android dhe browser-i; nëse Galeria hap Google Photos, provo Files.</p>
  {busy&&<div role="status"><label>Ngarkimi i medias<progress aria-label="Ngarkimi i medias" value={progress} max={100}/></label><span>{progress}% · {progress===100?'Duke përgatitur kopjen…':'Duke ngarkuar…'}</span><button type="button" onClick={()=>controller.current?.abort()}>Anulo ngarkimin</button></div>}
  {error&&<p role="alert" className="inline-error">{error}{retry&&!busy&&<button type="button" onClick={()=>void upload(retry.file,retry.kind)}>Riprovo ngarkimin</button>}</p>}
  {!!current.gallery?.length&&<div className="gallery-strip">{current.gallery.map((id,i)=><div key={`${id}-${i}`}><img src={mediaUrl(id)} alt={`Foto ${i+1}`}/><button type="button" aria-label={`Hiq fotografinë ${i+1}`} onClick={()=>update({gallery:current.gallery!.filter((_,j)=>j!==i)})}>Hiq</button></div>)}</div>}
  <PhotoAssistant photos={Array.from(new Set([...(current.gallery??[]),...(current.mediaId?[current.mediaId]:[])]))} revision={revision} objectId={object?.id} onApply={onSuggest}/>

  <p className="muted kind-hint">{kindContextHint[kind]??'Paneli ditor tregon vetëm përmbajtjen dhe kontrollet që i mbështet ky objekt.'}</p>
  <label>Visibility<select aria-label="Visibility" value={current.visibility??'private'} onChange={e=>update({visibility:e.target.value as HomeObject['visibility']})}><option value="private">Private Only</option><option value="invited">Invited Tour</option><option value="public">Public Showcase</option></select></label>
  <p className="muted">Asgjë nuk ndahet pa preview dhe miratimin tuaj.</p>
  <div className="capture-actions">{(['generic','product','photo','tv','piano','robot'].includes(kind)||current.videoId)&&<label className="secondary capture-label">Shto video MP4<input aria-label="Shto video MP4" type="file" accept="video/mp4" disabled={busy} onChange={e=>{void upload(e.target.files?.[0],'video');e.target.value='';}}/></label>}<label className="secondary capture-label">Shto dokument<input aria-label="Shto dokument" type="file" accept="application/pdf,text/plain,.pdf,.txt" disabled={busy} onChange={e=>{void upload(e.target.files?.[0],'document');e.target.value='';}}/></label></div>
  {current.videoId&&<div className="notice"><span>Video u shtua</span><button type="button" onClick={()=>update({videoId:undefined})}>Hiq videon</button></div>}
  {!!current.documents?.length&&<section aria-label="Dokumentet e objektit"><h3>Dokumente & manuale</h3>{current.documents.map((d,i)=><div key={d.id} className="document-card"><label>Titulli i dokumentit {i+1}<input value={d.title} maxLength={120} onChange={e=>update({documents:current.documents!.map((x,j)=>j===i?{...x,title:e.target.value}:x)})}/></label><label>Visibility e dokumentit {i+1}<select value={d.visibility} onChange={e=>update({documents:current.documents!.map((x,j)=>j===i?{...x,visibility:e.target.value as typeof d.visibility}:x)})}><option value="private">Private Only</option><option value="invited">Invited Tour</option><option value="public">Public Showcase</option></select></label><a href={mediaUrl(d.mediaId,d.mime==='application/pdf'?'document.pdf':'document.txt')} download>Preview / shkarko {d.mime==='application/pdf'?'PDF statik':'tekst'}</a><button type="button" onClick={()=>update({documents:current.documents!.filter((_,j)=>j!==i)})}>Hiq dokumentin {i+1}</button></div>)}</section>}
  <details><summary>Media të importuara</summary><button type="button" className="secondary" onClick={()=>void api<string[]>('/media').then(setMedia).catch(e=>setError(errorText(e)))}>Ngarko mediat</button><label>Fotografia kryesore<select value={current.mediaId??''} onChange={e=>update({mediaId:e.target.value||undefined})}><option value="">Pa fotografi kryesore</option>{mediaOptions.map(id=><option key={id}>{id}</option>)}</select></label></details>
  {(!['light','outlet','tv'].includes(kind)||current.experiences)&&<ExperienceFields object={{...current,actions} as HomeObject} media={mediaOptions} onChange={experiences=>update({experiences})}/>}
  <details><summary>Prezantim & veprime virtuale</summary>{simulations.length>0&&<label>Demonstrim virtual<select aria-label="Demonstrim virtual" value={demo?.type==='demo'?demo.demo:''} onChange={e=>secondary('demo',e.target.value?[{type:'demo',demo:e.target.value as 'piano'|'led-wall'|'robot'|'fridge'}]:[])}><option value="">Pa simulim</option>{simulations.map(value=><option key={value} value={value}>{{piano:'Piano · LED virtual','led-wall':'LED Wall · ngjyra & efekte',robot:'Robot · prezantim virtual',fridge:'Frigorifer · hap/mbyll i çiftuar'}[value]}</option>)}</select></label>}<label>Faqja zyrtare HTTPS<input type="url" placeholder="https://example.com/product" value={link?.type==='link'?link.url:''} onChange={e=>secondary('link',e.target.value?[{type:'link',label:'Faqja e produktit',url:e.target.value}]:[])}/></label><label>Dokumentacion / tekst<textarea value={current.documentation??''} maxLength={5000} onChange={e=>update({documentation:e.target.value})}/></label><label>Specifikime (Emri: Vlera, një për rresht)<textarea defaultValue={(current.specifications??[]).map(s=>`${s.label}: ${s.value}`).join('\n')} onChange={e=>update({specifications:e.target.value.split('\n').filter(Boolean).map(line=>{const i=line.indexOf(':');return {label:(i<0?line:line.slice(0,i)).trim(),value:i<0?'':line.slice(i+1).trim()};})})}/></label></details>
  {providerChoices.length>0&&<details><summary>Integrimi & lejet e familjes</summary><label>Provider (opsional)<select disabled={bindingManaged} value={current.provider?.active??''} onChange={e=>{const active=e.target.value as NonNullable<HomeObject['provider']>['active'];update({provider:active?{identity:current.provider?.identity??object?.id??crypto.randomUUID(),active,status:active==='mock'?'mock':'unconfigured'}:undefined,actions:[...actions.filter(a=>a.type!=='integration'),...(active&&active!=='mock'?[{type:'integration' as const,adapterId:active}]:[])]});}}><option value="">Pa integrim smart</option>{providerChoices.map(p=><option key={p}>{p}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={current.permissions?.householdView??false} onChange={e=>update({permissions:{householdControl:current.permissions?.householdControl??false,householdView:e.target.checked}})}/>Lejo shikimin nga familja</label><label className="check-row"><input type="checkbox" checked={current.permissions?.householdControl??false} onChange={e=>update({permissions:{householdView:current.permissions?.householdView??false,householdControl:e.target.checked}})}/>Lejo veprime MOCK për familjen e autorizuar</label><p className="muted">Zgjedhja e provider-it nuk aktivizon komanda fizike.</p></details>}
 </section>;
}

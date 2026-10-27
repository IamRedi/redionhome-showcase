import {useEffect,useRef,useState} from 'react';
import type {PhotoSuggestion} from '../shared/future.ts';
import type {PhotoFields} from '../shared/photo-assistant.ts';
import {api,errorText,mediaUrl} from './api.ts';
export function PhotoAssistant({photos,revision,objectId,onApply}:{photos:string[];revision:number;objectId?:string;onApply:(fields:PhotoFields&{photoSuggestionId:string})=>void}){
 const [config,setConfig]=useState<{enabled:boolean;label?:string;destination?:string}>(),[photo,setPhoto]=useState(photos[0]??''),[consent,setConsent]=useState(false),[proposal,setProposal]=useState<PhotoSuggestion>(),[fields,setFields]=useState<PhotoFields>({name:'',category:'',description:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;void api<{enabled:boolean;label?:string;destination?:string}>('/photo-assistant').then(setConfig).catch(e=>setError(errorText(e)));return()=>{mounted.current=false;controller.current?.abort();};},[]);
 const selected=photos.includes(photo)?photo:photos[0]??'';
 useEffect(()=>{controller.current?.abort();setConsent(false);setProposal(undefined);},[selected,revision]);
 return <details className="photo-assistant"><summary>Plotëso me AI · opsional</summary>
  {!config?.enabled?<p className="muted">AI nuk është konfiguruar në këtë instalim. Mund të plotësoni çdo fushë vetë; asnjë foto nuk dërgohet.</p>:<>
   <p className="muted">{config.label} propozon vetëm emrin, kategorinë dhe përshkrimin. Dërgohet vetëm kopja e fotos së zgjedhur, pa EXIF, te {config.destination}. Sugjerimi nuk ruan objektin dhe nuk kontrollon pajisje.</p>
   <label>Fotografia për AI<select aria-label="Fotografia për AI" value={selected} disabled={busy} onChange={e=>{setPhoto(e.target.value);setConsent(false);setProposal(undefined);}}>{photos.map((p,i)=><option key={p} value={p}>Foto {i+1}</option>)}</select></label>
   {selected&&<img className="ai-photo-preview" src={mediaUrl(selected)} alt="Fotografia e zgjedhur për AI"/>}
   <label className="check-row"><input aria-label="Miratoj dërgimin e kësaj fotoje te AI" type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>Miratoj dërgimin e kësaj fotoje te {config.label} për këtë sugjerim.</label>
   <button type="button" className="secondary wide" disabled={!consent||!selected||busy} onClick={()=>{
    const control=new AbortController();controller.current=control;setBusy(true);setError('');setProposal(undefined);
    void api<PhotoSuggestion>('/photo-suggestions','POST',{photoMediaId:selected,expectedRevision:revision,consent:true,objectId},control.signal).then(p=>{if(mounted.current&&!control.signal.aborted){setProposal(p);setFields({name:p.name,category:p.category,description:p.description});}}).catch(e=>{if(mounted.current)setError(control.signal.aborted?'Sugjerimi u anulua. Drafti juaj mbeti.':errorText(e));}).finally(()=>{if(mounted.current){setBusy(false);setConsent(false);}controller.current=null;});
   }}>Propozo nga fotografia</button>
   {busy&&<div role="status">Duke përgatitur sugjerimin…<button type="button" onClick={()=>controller.current?.abort()}>Anulo AI</button></div>}
   {proposal&&<fieldset><legend>Shqyrto dhe korrigjo sugjerimin</legend><label>Emri i propozuar<input value={fields.name} maxLength={120} onChange={e=>setFields({...fields,name:e.target.value})}/></label><label>Kategoria e propozuar<input value={fields.category} maxLength={80} onChange={e=>setFields({...fields,category:e.target.value})}/></label><label>Përshkrimi i propozuar<textarea value={fields.description} maxLength={2000} onChange={e=>setFields({...fields,description:e.target.value})}/></label><button type="button" className="secondary wide" disabled={busy||!fields.name.trim()||!fields.category.trim()} onClick={()=>{
    setBusy(true);setError('');void api<PhotoFields&{photoSuggestionId:string}>('/photo-suggestions/confirm','POST',{suggestionId:proposal.id,expectedRevision:revision,confirmed:true,corrected:fields}).then(result=>{onApply(result);setProposal(undefined);}).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));
   }}>Mirato dhe vendos në draft</button><button type="button" onClick={()=>setProposal(undefined)}>Refuzo sugjerimin</button></fieldset>}
  </>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
 </details>;
}

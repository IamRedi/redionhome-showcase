import {useEffect,useMemo,useRef,useState} from 'react';
import {Camera,Mic,MicOff,Navigation,Send,Volume2,X} from 'lucide-react';
import {Dialog} from './Dialog.tsx';
import type {AIHistory,AIResponse} from '../shared/ai.ts';
import type {DeviceSnapshot,Home} from '../shared/model.ts';
import {api,errorText,uploadMedia} from './api.ts';

type SpeechRecognitionEventLike={results:{[index:number]:{[index:number]:{transcript:string}}}};
type SpeechRecognitionLike={lang:string;interimResults:boolean;continuous:boolean;start():void;stop():void;onresult:((event:SpeechRecognitionEventLike)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null};
type SpeechRecognitionConstructor=new()=>SpeechRecognitionLike;
declare global{interface Window{webkitSpeechRecognition?:SpeechRecognitionConstructor;SpeechRecognition?:SpeechRecognitionConstructor}}

type ChatItem={role:'user'|'assistant';text:string;result?:AIResponse};

export function AIAssistant({home,onClose,onNavigate,onOpenObject,onDevices}:{home:Home;onClose:()=>void;onNavigate:(id:string)=>void;onOpenObject:(id:string)=>void;onDevices:(snapshot:DeviceSnapshot)=>void}){
 const [status,setStatus]=useState<{enabled:boolean;label?:string;destination?:string;model?:string;voice:string}>(),
  [items,setItems]=useState<ChatItem[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),
  [listening,setListening]=useState(false),[photo,setPhoto]=useState<File>(),[photoConsent,setPhotoConsent]=useState(false),[confirmed,setConfirmed]=useState<Set<string>>(new Set());
 const recognition=useRef<SpeechRecognitionLike|undefined>(undefined),endRef=useRef<HTMLDivElement>(null);
 const SpeechRecognition=typeof window==='undefined'?undefined:window.SpeechRecognition??window.webkitSpeechRecognition;
 useEffect(()=>{void api<{enabled:boolean;label?:string;destination?:string;model?:string;voice:string}>('/ai/status').then(setStatus).catch(e=>setError(errorText(e)));return()=>recognition.current?.stop();},[]);
 useEffect(()=>{endRef.current?.scrollIntoView?.({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[items,busy]);
 const history=useMemo<AIHistory[]>(()=>items.slice(-8).map(item=>({role:item.role,text:item.text})),[items]);
 const speak=(text:string)=>{if(!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='sq-AL';utterance.rate=.96;window.speechSynthesis.speak(utterance);};
 const listen=()=>{
  if(!SpeechRecognition)return;
  recognition.current?.stop();const current=new SpeechRecognition();recognition.current=current;current.lang='sq-AL';current.interimResults=false;current.continuous=false;
  current.onresult=event=>{setMessage(event.results[0]?.[0]?.transcript??'');setListening(false);};current.onerror=()=>{setListening(false);setError('Zëri nuk u lexua. Kontrolloni lejen e mikrofonit në Samsung Internet/Chrome.');};current.onend=()=>setListening(false);
  setError('');setListening(true);current.start();
 };
 const send=async()=>{
  const text=message.trim();if(!text||busy||!status?.enabled)return;
  setBusy(true);setError('');setItems(current=>[...current,{role:'user',text}]);setMessage('');
  try{
   let photoMediaId:string|undefined;
   if(photo){if(!photoConsent)throw Error('PHOTO_CONSENT');photoMediaId=(await uploadMedia(photo,'photo')).id;}
   const result=await api<AIResponse>('/ai/chat','POST',{message:text,history,...(photoMediaId?{photoMediaId,photoConsent:true}:{})});
   setItems(current=>[...current,{role:'assistant',text:result.reply,result}]);setPhoto(undefined);setPhotoConsent(false);
  }catch(e){setError(e instanceof Error&&e.message==='PHOTO_CONSENT'?'Miratoni dërgimin e fotos para analizës.':errorText(e));}
  finally{setBusy(false);}
 };
 const confirmCommands=async(result:AIResponse,index:number)=>{
  if(!result.commands.length||!window.confirm(`Të ekzekutohen ${result.commands.length} komandat e listuara për pajisjet e sakta?`))return;
  setBusy(true);setError('');try{
   for(const command of result.commands){const snapshot=await api<DeviceSnapshot>('/commands','POST',{objectId:command.objectId,action:command.action,...(command.brightness!==null?{brightness:command.brightness}:{}),...(command.confirmEntityId?{confirmEntityId:command.confirmEntityId}:{})});onDevices(snapshot);}
   setConfirmed(current=>new Set(current).add(`commands-${index}`));
  }catch(e){setError(errorText(e));}finally{setBusy(false);}
 };
 const confirmInventory=async(result:AIResponse,index:number)=>{
  if(!result.inventorySuggestionId)return;setBusy(true);setError('');try{await api('/ai/inventory-confirm','POST',{suggestionId:result.inventorySuggestionId,expectedRevision:home.revision,confirmed:true,items:result.inventory});setConfirmed(current=>new Set(current).add(`inventory-${index}`));}catch(e){setError(errorText(e));}finally{setBusy(false);}
 };
 return <Dialog title="Asistenti AI" eyebrow="RediOnHome" className="chat-dialog" onClose={onClose}><section className="ai-assistant">
  <details className="ai-status"><summary><i className={status?.enabled?'ready':'blocked'}/>{status?.enabled?'AI aktive':'AI joaktive'}</summary><p>{status?.enabled?`${status.label} · teksti, gjendja dhe fotografitë dërgohen vetëm kur kërkoni përgjigje. Pajisjet ndryshojnë vetëm pasi konfirmoni komandat.`:'AI nuk është konfiguruar ende. Asnjë kërkesë e jashtme nuk bëhet.'}</p></details>
  <div className="ai-thread" aria-live="polite">
   {!items.length&&<div className="ai-welcome"><h3>Si mund të ndihmoj?</h3><p>Pyet për shtëpinë, objektet ose pajisjet.</p><div>{['Ku është drita e kuzhinës?','Çfarë ka në këtë raft?'].map(example=><button key={example} onClick={()=>setMessage(example)}>{example}</button>)}</div></div>}
   {items.map((item,index)=><article key={index} className={`ai-message ${item.role}`}><p>{item.text}</p>{item.role==='assistant'&&<button className="ai-speak icon-button" title="Lexo përgjigjen me zë" aria-label="Lexo përgjigjen me zë" onClick={()=>speak(item.text)}><Volume2 size={17}/></button>}
    {item.result?.navigation.type==='scene'&&item.result.navigation.targetId&&<button className="secondary wide" onClick={()=>onNavigate(item.result!.navigation.targetId!)}><Navigation size={16}/>Hap dhomën</button>}
    {item.result?.navigation.type==='object'&&item.result.navigation.targetId&&<button className="secondary wide" onClick={()=>onOpenObject(item.result!.navigation.targetId!)}><Navigation size={16}/>Hap objektin</button>}
    {!!item.result?.commands.length&&<section className="ai-proposal"><strong>Komanda të propozuara · ende të paekzekutuara</strong>{item.result.commands.map((command,i)=><p key={`${command.objectId}-${i}`}>{home.objects.find(object=>object.id===command.objectId)?.name??command.objectId}: {command.action==='turn_on'?'ndize':command.action==='turn_off'?'fike':`ndriçim ${command.brightness}%`}<small>{command.reason}</small></p>)}<button className="primary wide" disabled={busy||confirmed.has(`commands-${index}`)} onClick={()=>void confirmCommands(item.result!,index)}>{confirmed.has(`commands-${index}`)?'Komandat u konfirmuan':'Shqyrto dhe konfirmo komandat'}</button></section>}
    {!!item.result?.inventory.length&&<section className="ai-proposal"><strong>Inventar i propozuar nga fotografia</strong><ul>{item.result.inventory.map((entry,i)=><li key={`${entry.name}-${i}`}><span>{entry.name} · {entry.quantity}</span><small>{entry.location||'Vendndodhje e pasigurt'} · siguri {entry.confidence}</small></li>)}</ul>{item.result.inventorySuggestionId&&<button className="primary wide" disabled={busy||confirmed.has(`inventory-${index}`)} onClick={()=>void confirmInventory(item.result!,index)}>{confirmed.has(`inventory-${index}`)?'Inventari u konfirmua':'Konfirmo këtë inventar'}</button>}</section>}
    {!!item.result?.limitations.length&&<details><summary>Kufizime të përgjigjes</summary>{item.result.limitations.map((entry,i)=><p className="muted" key={i}>{entry}</p>)}</details>}
   </article>)}
   {busy&&<div className="ai-thinking" role="status">Duke analizuar…</div>}<div ref={endRef}/>
  </div>
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {photo&&<div className="ai-photo"><span>{photo.name}</span><button type="button" className="icon-button" aria-label="Hiq fotografinë" onClick={()=>{setPhoto(undefined);setPhotoConsent(false);}}><X size={16}/></button><label><input type="checkbox" checked={photoConsent} onChange={event=>setPhotoConsent(event.target.checked)}/> Miratoj dërgimin e kësaj kopjeje te {status?.label??'AI'}.</label></div>}
  <form className="ai-compose" onSubmit={event=>{event.preventDefault();void send();}}>
   <textarea aria-label="Mesazhi për AI" value={message} onChange={event=>setMessage(event.target.value)} placeholder="Pyet diçka…" maxLength={1200} rows={2}/>
   <div className="ai-compose-tools"><label className="ai-camera icon-button" title="Shto fotografi"><Camera size={20}/><input aria-label="Shto fotografi" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={event=>{setPhoto(event.target.files?.[0]);setPhotoConsent(false);}}/></label>
   <button type="button" className={`icon-button ${listening?'listening':''}`} title="Fol shqip" aria-label={SpeechRecognition?'Fol shqip':'Zëri nuk mbështetet nga ky shfletues'} disabled={!SpeechRecognition||busy} onClick={listen}>{SpeechRecognition?(listening?<MicOff size={20}/>:<Mic size={20}/>):<MicOff size={20}/>}</button>
   <button className="ai-send icon-button" title="Dërgo" aria-label="Dërgo te AI" disabled={busy||!status?.enabled||!message.trim()||!!photo&&!photoConsent}><Send size={20}/></button></div>
  </form>
  {!SpeechRecognition&&<small className="ai-voice-note">Ky shfletues nuk ekspozon njohjen e zërit. Teksti dhe leximi me zë mbeten funksionalë.</small>}
 </section></Dialog>;
}

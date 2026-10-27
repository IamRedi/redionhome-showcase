import {useEffect,useMemo,useRef,useState} from 'react';
import {Camera,Mic,MicOff,Navigation,Send,Volume2,X} from 'lucide-react';
import {Dialog} from './Dialog.tsx';
import type {AIHistory,AIResponse} from '../shared/ai.ts';
import type {DeviceSnapshot,Home} from '../shared/model.ts';
import {ActionCenter,RunResult,type CenterSection} from './ActionCenter.tsx';
import type {ActionRun} from '../shared/actions.ts';
import {ApiError,api,errorText,uploadMedia} from './api.ts';

type SpeechRecognitionEventLike={results:{[index:number]:{[index:number]:{transcript:string}}}};
type SpeechRecognitionLike={lang:string;interimResults:boolean;continuous:boolean;start():void;stop():void;onresult:((event:SpeechRecognitionEventLike)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null};
type SpeechRecognitionConstructor=new()=>SpeechRecognitionLike;
declare global{interface Window{webkitSpeechRecognition?:SpeechRecognitionConstructor;SpeechRecognition?:SpeechRecognitionConstructor}}

type ChatItem={role:'user'|'assistant';text:string;result?:AIResponse};

export function AIAssistant({home,context,onClose,onNavigate,onOpenObject,onDevices}:{home:Home;context?:string;onClose:()=>void;onNavigate:(id:string)=>void;onOpenObject:(id:string)=>void;onDevices:(snapshot:DeviceSnapshot)=>void}){
 const [status,setStatus]=useState<{enabled:boolean;label?:string;destination?:string;model?:string;voice:string}>(),
  [items,setItems]=useState<ChatItem[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),
  [listening,setListening]=useState(false),[photo,setPhoto]=useState<File>(),[photoConsent,setPhotoConsent]=useState(false),[confirmed,setConfirmed]=useState<Set<string>>(new Set());
 const recognition=useRef<SpeechRecognitionLike|undefined>(undefined),endRef=useRef<HTMLDivElement>(null);
 const centerScroll=useRef<HTMLDivElement>(null);
 const [section,setSection]=useState<'chat'|CenterSection>('chat'),[ambientNames,setAmbientNames]=useState<Record<number,string>>({});
 const active=useRef<{kind:'chat'|'run';id:string;controller:AbortController}|undefined>(undefined),channel=useRef<'text'|'voice'>('text');
 const retry=useRef<{text:string;photo?:File;body:Record<string,unknown>}|undefined>(undefined);
 const stop=()=>{const request=active.current;if(!request)return;void api(request.kind==='chat'?'/ai/stop':`/action-runs/${request.id}/stop`,'POST',request.kind==='chat'?{requestId:request.id}:{}).catch(()=>undefined);request.controller.abort();};
 const close=()=>{stop();onClose();};
 useEffect(()=>{centerScroll.current?.scrollTo({top:0});},[section]);
 const SpeechRecognition=import.meta.env.VITE_SHOWCASE==='1'||typeof window==='undefined'?undefined:window.SpeechRecognition??window.webkitSpeechRecognition;
 useEffect(()=>{void api<{enabled:boolean;label?:string;destination?:string;model?:string;voice:string}>('/ai/status').then(setStatus).catch(e=>setError(errorText(e)));return()=>{const request=active.current;if(request){void fetch(`/api/v1${request.kind==='chat'?'/ai/stop':`/action-runs/${request.id}/stop`}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.kind==='chat'?{requestId:request.id}:{}),keepalive:true});request.controller.abort();}recognition.current?.stop();window.speechSynthesis?.cancel();};},[]);
 useEffect(()=>{endRef.current?.scrollIntoView?.({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});},[items,busy]);
 const history=useMemo<AIHistory[]>(()=>items.slice(-8).map(item=>({role:item.role,text:item.text})),[items]);
 const speak=(text:string)=>{if(import.meta.env.VITE_SHOWCASE==='1')return;if(!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='sq-AL';utterance.rate=.96;window.speechSynthesis.speak(utterance);};
 const listen=()=>{
  if(listening){recognition.current?.stop();setListening(false);return;}
  if(!SpeechRecognition)return;
  recognition.current?.stop();const current=new SpeechRecognition();recognition.current=current;current.lang='sq-AL';current.interimResults=false;current.continuous=false;
  current.onresult=event=>{if(recognition.current!==current)return;setMessage(event.results[0]?.[0]?.transcript??'');channel.current='voice';setListening(false);};current.onerror=()=>{if(recognition.current!==current)return;setListening(false);setError('Zëri nuk u lexua. Kontrolloni lejen e mikrofonit në Samsung Internet/Chrome.');};current.onend=()=>{if(recognition.current===current)setListening(false);};
  setError('');
  try{current.start();setListening(true);}catch{setListening(false);setError('Mikrofoni nuk u hap. Provoni përsëri ose shkruani mesazhin.');}
 };
 const send=async()=>{
  const text=message.trim();if(!text||busy||!status?.enabled)return;
  if(recognition.current){recognition.current.onresult=null;recognition.current.stop();}setListening(false);
  const controller=new AbortController(),previous=retry.current;
  const referenceRunId=[...items].reverse().find(item=>item.result?.execution)?.result?.execution?.id;
  const body:Record<string,unknown>=previous?.text===text&&previous.photo===photo?previous.body:{message:text,history,requestId:crypto.randomUUID(),channel:channel.current,...(referenceRunId?{referenceRunId}:{})};
  active.current={kind:'chat',id:String(body.requestId),controller};
  const pendingItem:ChatItem={role:'user',text};
  setBusy(true);setError('');setItems(current=>[...current,pendingItem]);setMessage('');
  try{
   let photoMediaId:string|undefined;
   if(photo&&!body.photoMediaId){if(!photoConsent)throw Error('PHOTO_CONSENT');photoMediaId=(await uploadMedia(photo,'photo')).id;body.photoMediaId=photoMediaId;body.photoConsent=true;}
   retry.current={text,photo,body};
   if(controller.signal.aborted)throw new DOMException('Stopped','AbortError');
   const result=await api<AIResponse>('/ai/chat','POST',body,controller.signal);retry.current=undefined;
   setItems(current=>[...current,{role:'assistant',text:result.reply,result}]);setPhoto(undefined);setPhotoConsent(false);
  }catch(e){if(e instanceof ApiError)retry.current=undefined;setItems(current=>current.filter(item=>item!==pendingItem));setMessage(text);setError(e instanceof Error&&e.message==='PHOTO_CONSENT'?'Miratoni dërgimin e fotos para analizës.':`${errorText(e)} Mesazhi juaj mbeti më poshtë.`);}
  finally{active.current=undefined;setBusy(false);}
 };
 const confirmCommands=async(result:AIResponse,index:number)=>{
  if(result.execution?.status!=='awaiting_confirmation'||!window.confirm(`Të ekzekutohen ${result.execution.steps.length} hapat e listuar?`))return;
  const controller=new AbortController();active.current={kind:'run',id:result.execution.id,controller};
  setBusy(true);setError('');try{
   const execution=await api<ActionRun>(`/action-runs/${result.execution.id}/execute`,'POST',{confirmed:true},controller.signal);
   setItems(current=>current.map((item,i)=>i===index?{...item,result:{...item.result!,execution}}:item));
   onDevices(await api<DeviceSnapshot>('/devices'));
  }catch(e){setError(errorText(e));}finally{active.current=undefined;setBusy(false);}
 };
 const saveAmbient=async(result:AIResponse,index:number)=>{
  if(!result.execution)return;setBusy(true);setError('');try{await api('/ambients','POST',{name:ambientNames[index]??result.ambient?.name??'Ambient i ri',roomId:result.execution.steps[0].roomId,runId:result.execution.id});setConfirmed(current=>new Set(current).add(`ambient-${index}`));}catch(e){setError(errorText(e));}finally{setBusy(false);}
 };
 const confirmInventory=async(result:AIResponse,index:number)=>{
  if(!result.inventorySuggestionId)return;setBusy(true);setError('');try{await api('/ai/inventory-confirm','POST',{suggestionId:result.inventorySuggestionId,expectedRevision:home.revision,confirmed:true,items:result.inventory});setConfirmed(current=>new Set(current).add(`inventory-${index}`));}catch(e){setError(errorText(e));}finally{setBusy(false);}
 };
 const statusLabel=status?(status.enabled?'AI aktive':'AI joaktive'):error?'Lidhja me AI nuk u verifikua':'Duke kontrolluar AI…';
 const statusDescription=status?.enabled?`${status.label} · teksti, gjendja dhe fotografitë dërgohen vetëm kur kërkoni përgjigje. Veprimet kontrollohen nga lejet e ruajtura te Lejet; rezultati verifikohet për çdo hap.`:status?'AI nuk është konfiguruar ende. Asnjë kërkesë e jashtme nuk bëhet.':error?'Mbyllni dhe rihapni asistentin për ta provuar përsëri.':'Po kontrollojmë lidhjen me asistentin.';
 return <Dialog assistant title="Asistenti AI" eyebrow={`R AI · ${context??'RediOnHome'}`} className="chat-dialog" onClose={close}><section className="ai-assistant">
  <details className="ai-status"><summary><i className={status?.enabled?'ready':'blocked'}/>{statusLabel}</summary><p>{statusDescription}</p></details>
  <nav className="ai-sections" aria-label="Seksionet e R AI">{([['chat','Biseda'],['ambients','Ambiente'],['permissions','Lejet'],['activity','Aktiviteti']] as const).map(([id,label])=><button key={id} aria-pressed={section===id} disabled={busy} onClick={()=>setSection(id)}>{label}</button>)}</nav>
  {section!=='chat'&&<div className="ai-thread" ref={centerScroll}><ActionCenter section={section} home={home}/></div>}
  <div className="ai-thread" aria-live="polite" hidden={section!=='chat'}>
   {!items.length&&<div className="ai-welcome"><h3>Si mund të ndihmoj?</h3><p>Pyet për shtëpinë, objektet ose pajisjet.</p><div>{['Ku është drita e kuzhinës?','Çfarë ka në këtë raft?'].map(example=><button key={example} onClick={()=>setMessage(example)}>{example}</button>)}</div></div>}
   {items.map((item,index)=><article key={index} className={`ai-message ${item.role}`}><p>{item.text}</p>{item.role==='assistant'&&<button className="ai-speak icon-button" title="Lexo përgjigjen me zë" aria-label="Lexo përgjigjen me zë" onClick={()=>speak(item.text)}><Volume2 size={17}/></button>}
    {item.result?.navigation.type==='scene'&&item.result.navigation.targetId&&<button className="secondary wide" onClick={()=>onNavigate(item.result!.navigation.targetId!)}><Navigation size={16}/>Hap dhomën</button>}
    {item.result?.navigation.type==='object'&&item.result.navigation.targetId&&<button className="secondary wide" onClick={()=>onOpenObject(item.result!.navigation.targetId!)}><Navigation size={16}/>Hap objektin</button>}
    {item.result?.execution&&<>
      {['awaiting_confirmation','blocked'].includes(item.result.execution.status)&&<strong>Komanda të propozuara · ende të paekzekutuara</strong>}
      <RunResult run={item.result.execution}/>
      {item.result.execution.status==='blocked'&&<p className="muted">R AI është në mënyrën “Vetëm këshillon”. Zgjidhni pajisjet dhe mënyrën te Lejet për kërkesat e ardhshme.</p>}
      {item.result.execution.status==='awaiting_confirmation'&&<button className="primary wide" disabled={busy} onClick={()=>void confirmCommands(item.result!,index)}>Shqyrto dhe konfirmo komandat</button>}
      {item.result.execution.status==='succeeded'&&<button className="secondary" disabled>Komandat u konfirmuan</button>}
      {item.result.execution.source!=='ambient'&&<div className="save-ambient"><label>Emri për ambientin<input aria-label={`Emri për ambientin ${index}`} disabled={busy||confirmed.has(`ambient-${index}`)} value={ambientNames[index]??item.result.ambient?.name??'Ambient i ri'} maxLength={80} onChange={e=>setAmbientNames(current=>({...current,[index]:e.target.value}))}/></label><button className="secondary" disabled={busy||confirmed.has(`ambient-${index}`)} onClick={()=>void saveAmbient(item.result!,index)}>{confirmed.has(`ambient-${index}`)?'Ambienti u ruajt':'Ruaj si ambient'}</button></div>}
    </>}
    {!!item.result?.inventory.length&&<section className="ai-proposal"><strong>Inventar i propozuar nga fotografia</strong><ul>{item.result.inventory.map((entry,i)=><li key={`${entry.name}-${i}`}><span>{entry.name} · {entry.quantity}</span><small>{entry.location||'Vendndodhje e pasigurt'} · siguri {entry.confidence}</small></li>)}</ul>{item.result.inventorySuggestionId&&<button className="primary wide" disabled={busy||confirmed.has(`inventory-${index}`)} onClick={()=>void confirmInventory(item.result!,index)}>{confirmed.has(`inventory-${index}`)?'Inventari u konfirmua':'Konfirmo këtë inventar'}</button>}</section>}
    {!!item.result?.limitations.length&&<details><summary>Kufizime të përgjigjes</summary>{item.result.limitations.map((entry,i)=><p className="muted" key={i}>{entry}</p>)}</details>}
   </article>)}
   {busy&&<div className="ai-thinking" role="status">Duke përpunuar…</div>}<div ref={endRef}/>
  </div>
  {busy&&<button type="button" className="secondary" onClick={stop}>Ndalo</button>}
  {error&&<p className="inline-error" role="alert">{error}</p>}
  {photo&&<div className="ai-photo"><span>{photo.name}</span><button type="button" className="icon-button" aria-label="Hiq fotografinë" disabled={busy} onClick={()=>{setPhoto(undefined);setPhotoConsent(false);}}><X size={16}/></button><label><input type="checkbox" disabled={busy} checked={photoConsent} onChange={event=>setPhotoConsent(event.target.checked)}/> Miratoj dërgimin e kësaj kopjeje te {status?.label??'AI'}.</label></div>}
  <form hidden={section!=='chat'} className="ai-compose" onSubmit={event=>{event.preventDefault();void send();}}>
   <textarea aria-label="Mesazhi për AI" readOnly={busy} aria-busy={busy} value={message} onChange={event=>{setMessage(event.target.value);channel.current='text';}} placeholder="Pyet diçka…" maxLength={1200} rows={2}/>
   <div className="ai-compose-tools"><label className="ai-camera icon-button" title="Shto fotografi"><Camera size={20}/><input aria-label="Shto fotografi" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={event=>{setPhoto(event.target.files?.[0]);setPhotoConsent(false);}}/></label>
   <button type="button" className={`icon-button ${listening?'listening':''}`} title={listening?'Ndalo dëgjimin':'Fol shqip'} aria-label={SpeechRecognition?listening?'Ndalo dëgjimin':'Fol shqip':'Zëri nuk mbështetet nga ky shfletues'} aria-pressed={listening} disabled={!SpeechRecognition||busy} onClick={listen}>{SpeechRecognition?(listening?<MicOff size={20}/>:<Mic size={20}/>):<MicOff size={20}/>}</button>
   <button className="ai-send icon-button" title="Dërgo" aria-label="Dërgo te AI" disabled={busy||!status?.enabled||!message.trim()||!!photo&&!photoConsent}><Send size={20}/></button></div>
  </form>
  {listening&&<small className="ai-listening" role="status">Po dëgjoj… Prekni mikrofonin për ta ndaluar.</small>}
  {!SpeechRecognition&&<small className="ai-voice-note">{import.meta.env.VITE_SHOWCASE==='1'?'Zëri është i çaktivizuar në demonstrimin offline.':'Ky shfletues nuk ekspozon njohjen e zërit. Teksti dhe leximi me zë mbeten funksionalë.'}</small>}
 </section></Dialog>;
}

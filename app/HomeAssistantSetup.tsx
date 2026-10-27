import {useEffect,useState} from 'react';
import type {Home} from '../shared/model.ts';
import {api,errorText} from './api.ts';
import {Dialog} from './Dialog.tsx';

type Info={status:'UNCONFIGURED'|'CONNECTING'|'CONNECTED'|'UNAVAILABLE'|'ERROR';configured:boolean;origin:string|null;error:string|null};
type Item={entityId:string;name:string;domain:string;source:'home-assistant';state:'on'|'off'|'available'|'unavailable';rawState?:string;observedAt:string|null;supported:boolean;capabilities:string[]};
type Binding={bindingId:string;objectId:string;entityId:string};
type Filter='ready'|'linked'|'other';
const stateLabel=(state:Item['state'])=>state==='on'?'Ndezur':state==='off'?'Fikur':state==='available'?'Aktive':'Pa gjendje';
const kindLabel=(domain:string)=>({light:'Dritë',switch:'Çelës',cover:'Perde',sensor:'Sensor',binary_sensor:'Sensor',climate:'Klimë',fan:'Ventilator',media_player:'Media',valve:'Valvul',lock:'Bravë'}[domain]??domain);

export function HomeAssistantSetup({home,onClose,onSave,onCreateObject,initialObjectId}:{home:Home;onClose:()=>void;onSave:(home:Home)=>void;onCreateObject?:()=>void;initialObjectId?:string}){
 const [info,setInfo]=useState<Info|null>(null),[origin,setOrigin]=useState(''),[items,setItems]=useState<Item[]>([]),[bindings,setBindings]=useState<Binding[]>([]);
 const [filter,setFilter]=useState<Filter>('ready'),[query,setQuery]=useState(''),[entityId,setEntityId]=useState(''),[objectId,setObjectId]=useState(initialObjectId??''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=async()=>{
  const [nextInfo,nextBindings]=await Promise.all([api<Info>('/ha'),api<Binding[]>('/ha/bindings')]);
  const nextItems=nextInfo.configured?await api<Item[]>('/ha/inventory'):[];
  setInfo(nextInfo);setOrigin(nextInfo.origin??'');setBindings(nextBindings);setItems(nextItems);
  if(initialObjectId){const binding=nextBindings.find(b=>b.objectId===initialObjectId);if(binding){setFilter('linked');setEntityId(binding.entityId);}}
 };
 useEffect(()=>{let active=true;void Promise.all([api<Info>('/ha'),api<Binding[]>('/ha/bindings')]).then(async([nextInfo,nextBindings])=>{
  const nextItems=nextInfo.configured?await api<Item[]>('/ha/inventory'):[];
  if(!active)return;setInfo(nextInfo);setOrigin(nextInfo.origin??'');setBindings(nextBindings);setItems(nextItems);
  if(initialObjectId){const binding=nextBindings.find(b=>b.objectId===initialObjectId);if(binding){setFilter('linked');setEntityId(binding.entityId);}}
 }).catch(e=>{if(active)setError(errorText(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await task();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 const linkedById=new Map(bindings.map(b=>[b.entityId,b]));
 const selected=items.find(e=>e.entityId===entityId);
 const targets=home.objects.filter(o=>home.scenes.some(s=>s.hotspots.some(h=>h.objectId===o.id))&&!o.actions.some(a=>a.type==='portal'));
 const eligible=items.filter(e=>e.supported),linked=eligible.filter(e=>linkedById.has(e.entityId)),ready=eligible.filter(e=>!linkedById.has(e.entityId)),other=items.filter(e=>!e.supported);
 const rows=(filter==='ready'?ready:filter==='linked'?linked:other).filter(e=>(e.name+' '+e.entityId+' '+e.domain).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const occupied=(id:string)=>{const object=home.objects.find(o=>o.id===id);return object?.provider?.status==='configured'||object?.actions.some(a=>a.type==='device');};
 return <Dialog title="Pajisjet e shtëpisë" eyebrow="INTEGRIMET · HOME ASSISTANT" onClose={onClose}>
  <div className="editor-form device-catalog">
   <div className="device-catalog-intro"><p>Shiko pajisjet që Home Assistant ka zbuluar. Për vendosje dhe kontrollet e mbështetura përdor + Shto në panoramë.</p><span className="device-readonly">LIDHJA KËRKON IDENTITET TË KONFIRMUAR</span></div>
   <div className="device-connection" role="status"><span className={'connection-dot '+(info?.status==='CONNECTED'?'connected':'')}/><strong>{info?.status==='CONNECTED'?'Home Assistant i lidhur':info?.status==='UNCONFIGURED'?'Home Assistant pa lidhje':info?.status==='CONNECTING'?'Duke u lidhur…':'Home Assistant i padisponueshëm'}</strong>{info?.error&&<small>{info.error}</small>}</div>
   {!info?.configured&&<div className="device-setup"><p>Lidhja me Home Assistant bëhet një herë nga pronari. Pajisjet e disponueshme atje do të shfaqen në këtë listë.</p><label>Adresa Home Assistant<input type="url" value={origin} onChange={e=>setOrigin(e.target.value)} placeholder="http://homeassistant.local:8123/" autoComplete="off" disabled={busy}/></label><p className="muted">Kredenciali mbahet vetëm në server. Nëse mungon, lidhja nuk mund të përfundojë nga telefoni.</p><button type="button" className="primary" disabled={busy||!origin} onClick={()=>void run(async()=>{await api<Info>('/ha/configure','POST',{origin});await load();setMessage('Lidhja u testua. Lista e pajisjeve është gati.');})}>Lidh Home Assistant</button></div>}
   {info?.configured&&<>
    <div className="device-summary"><div><strong>{ready.length}</strong><span>Për t'u shtuar</span></div><div><strong>{linked.length}</strong><span>Të lidhura</span></div><div><strong>{other.length}</strong><span>Të tjera</span></div></div>
    <div className="device-toolbar"><label>Kërko pajisje<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Emri ose ID e pajisjes" autoComplete="off"/></label><button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{await load();setMessage('Lista dhe gjendja u përditësuan.');})}>Rifresko listën</button></div>
    <div className="device-filters" role="group" aria-label="Filtro pajisjet"><button type="button" aria-pressed={filter==='ready'} onClick={()=>{setFilter('ready');setEntityId('');setQuery('');}}>Për t'u shtuar ({ready.length})</button><button type="button" aria-pressed={filter==='linked'} onClick={()=>{setFilter('linked');setEntityId('');setQuery('');}}>Të lidhura ({linked.length})</button><button type="button" aria-pressed={filter==='other'} onClick={()=>{setFilter('other');setEntityId('');setQuery('');}}>Të tjera ({other.length})</button></div>
    <p className="muted device-list-note">{filter==='other'?'Këto entitete nuk kanë një paraqitje të sigurt në këtë version.':'Zgjidh një pajisje. Emri i saj nuk e lidh automatikisht me objektin fizik.'}</p>
    <ul className="device-list" aria-label="Lista e pajisjeve">{rows.map(item=>{const binding=linkedById.get(item.entityId);const object=binding&&home.objects.find(o=>o.id===binding.objectId);return <li key={item.entityId}><button type="button" className={'device-card '+(entityId===item.entityId?'selected':'')} aria-pressed={entityId===item.entityId} onClick={()=>{setEntityId(item.entityId);setConfirmed(false);}}><span className="device-card-main"><strong>{item.name}</strong><small>{kindLabel(item.domain)} · Home Assistant · {item.entityId}</small>{binding&&<small>E lidhur me: {object?.name??'Objekt i panjohur'}</small>}{item.observedAt&&<small>Lexuar: {new Date(item.observedAt).toLocaleString()}</small>}</span><span className={'device-state '+item.state}><i/>{item.supported?stateLabel(item.state):item.rawState??'Vetëm listë'}</span></button></li>;})}</ul>
    {!rows.length&&<p className="notice">{query?'Nuk u gjet pajisje me këtë kërkim.':filter==='ready'?'Nuk ka pajisje të tjera për lidhje.':filter==='linked'?'Ende nuk ke lidhur pajisje.':'Nuk ka entitete të tjera.'}</p>}
    {selected?.supported&&!linkedById.has(selected.entityId)&&<section className="device-bind"><h3>Shto {selected.name}</h3><p>{kindLabel(selected.domain)} · {stateLabel(selected.state)} · lexim gjendjeje. Komandat ON/OFF nuk aktivizohen nga kjo lidhje.</p><label>Zgjidh objektin në panoramë<select value={objectId} onChange={e=>{setObjectId(e.target.value);setConfirmed(false);}}><option value="">Zgjidh objektin</option>{targets.map(o=><option key={o.id} value={o.id} disabled={occupied(o.id)}>{o.name} · {home.rooms.find(r=>r.id===o.roomId)?.name}{occupied(o.id)?' · i lidhur tashmë':''}</option>)}</select></label>{!targets.length&&<><p className="muted">Krijo fillimisht një objekt me pikë në panoramë.</p>{onCreateObject&&<button type="button" className="secondary" onClick={onCreateObject}>Krijo objekt në panoramë</button>}</>}
     <label className="device-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Konfirmoj se kjo pajisje është objekti fizik që zgjodha.</label><button type="button" className="primary wide" disabled={busy||!objectId||occupied(objectId)||!confirmed} onClick={()=>void run(async()=>{const next=await api<Home>('/ha/bind','POST',{objectId,entityId:selected.entityId,expectedRevision:home.revision,confirmSamePhysicalDevice:true});onSave(next);setBindings(await api<Binding[]>('/ha/bindings'));setFilter('linked');setEntityId(selected.entityId);setConfirmed(false);setMessage(selected.name+' u lidh me objektin. Gjendja mbetet vetëm për lexim.');})}>Shto te objekti</button></section>}
    {selected?.supported&&linkedById.has(selected.entityId)&&<section className="device-bind"><h3>{selected.name}</h3><p>E lidhur me {home.objects.find(o=>o.id===linkedById.get(selected.entityId)?.objectId)?.name??'objektin'} · {stateLabel(selected.state)} · vetëm lexim.</p>{home.objects.find(o=>o.id===linkedById.get(selected.entityId)?.objectId)?.actions.some(a=>a.type==='portal')&&<p className="inline-error">Kjo pajisje është lidhur me një kalim dhomash. Ai hotspot navigon; nuk hap kontroll. Hiq lidhjen dhe shtoje te një pikë drite me + Shto.</p>}<button type="button" className="secondary" disabled={busy} onClick={()=>{const binding=linkedById.get(selected.entityId);if(!binding||!window.confirm('Hiq lidhjen e '+selected.name+' nga objekti?'))return;void run(async()=>{const next=await api<Home>('/ha/unbind','POST',{objectId:binding.objectId,expectedRevision:home.revision});onSave(next);setBindings(await api<Binding[]>('/ha/bindings'));setFilter('ready');setEntityId('');setMessage('Lidhja u hoq. Objekti dhe media mbeten.');});}}>Hiq lidhjen</button></section>}
    <details className="device-advanced"><summary>Gjendja e lidhjes</summary><p>Burimi: {info.origin}. Kredencialet nuk shfaqen në telefon.</p><button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{setInfo(await api<Info>('/ha/test','POST'));setMessage('Lidhja u testua.');})}>Testo lidhjen</button></details>
   </>}
   {loading&&<p role="status">Po ngarkohet lista…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="inline-error">{error}</p>}
  </div>
 </Dialog>;
}

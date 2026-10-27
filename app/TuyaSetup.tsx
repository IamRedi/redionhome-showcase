import {useEffect,useState} from 'react';
import type {Home,DeviceSnapshot} from '../shared/model.ts';
import {api,errorText} from './api.ts';
import {Dialog} from './Dialog.tsx';

type Info={status:'AUTH_BLOCKED'|'DIAGNOSTIC_READ_ONLY';physicalCommands:false};
type Device={id:string;name:string;online:boolean;supportedCapabilities:string[]};
type Binding={deviceId:string;objectId:string;primaryProvider:string;externalId:string};

export function TuyaSetup({home,onClose,onSave}:{home:Home;onClose:()=>void;onSave:(home:Home)=>void}){
 const [info,setInfo]=useState<Info|null>(null),[devices,setDevices]=useState<Device[]>([]),[bindings,setBindings]=useState<Binding[]>([]);
 const [selected,setSelected]=useState(''),[objectId,setObjectId]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [snapshot,setSnapshot]=useState<DeviceSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{void Promise.all([api<Info>('/tuya'),api<Binding[]>('/tuya/bindings')]).then(([i,b])=>{setInfo(i);setBindings(b);}).catch(e=>setError(errorText(e)));},[]);
 const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await task();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 const hotspots=home.objects.filter(o=>home.scenes.some(s=>s.hotspots.some(h=>h.objectId===o.id)));
 return <Dialog title="Smart Life/Tuya" eyebrow="SETTINGS · INTEGRATIONS" onClose={onClose}><div className="editor-form">
  <p role="status">{info?.status??'Kontrollim…'} · vetëm lexim · komanda fizike të bllokuara</p>
  <p>Projekti Tuya Cloud duhet të jetë në rajonin e llogarisë Smart Life dhe llogaria të lidhet me QR në Tuya Developer Platform. Kredencialet qëndrojnë vetëm në skedar privat backend; kjo faqe nuk i kërkon dhe nuk i ruan.</p>
  <button type="button" className="secondary" disabled={busy||info?.status!=='DIAGNOSTIC_READ_ONLY'} onClick={()=>void run(async()=>{const found=await api<Device[]>('/tuya/discover');setDevices(found);setMessage(`${found.length} pajisje u zbuluan. Discovery nuk autorizon komandë.`);})}>Discover · READ-ONLY</button>
  {!!devices.length&&<><label>Select Device<select value={selected} onChange={e=>{setSelected(e.target.value);setConfirmed(false);}}><option value="">Zgjidhni pajisjen</option>{devices.map(d=><option key={d.id} value={d.id} disabled={!d.supportedCapabilities.includes('power')}>{d.name} · {d.online?'online':'offline'} · {d.supportedCapabilities.includes('power')?'power READ-ONLY':'state not supported'} · {d.id}</option>)}</select></label>
   <label>Bind to Object · hotspot në panoramë<select value={objectId} onChange={e=>{setObjectId(e.target.value);setConfirmed(false);}}><option value="">Zgjidhni objektin</option>{hotspots.map(o=><option key={o.id} value={o.id}>{o.name} · {home.rooms.find(r=>r.id===o.roomId)?.name}{o.provider?.active?` · existing ${o.provider.active}`:''}</option>)}</select></label>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Konfirmoj se kjo pajisje është objekti fizik i zgjedhur. Emri i ngjashëm nuk mjafton.</label>
   <button type="button" className="primary" disabled={busy||!selected||!objectId||!confirmed} onClick={()=>void run(async()=>{const next=await api<Home>('/tuya/bind','POST',{objectId,deviceId:selected,expectedRevision:home.revision,confirmSamePhysicalDevice:true});onSave(next);setBindings(await api<Binding[]>('/tuya/bindings'));setMessage('Identiteti u lidh. Gjendja shfaqet vetëm për lexim.');})}>Bind to Object</button></>}
  {!!bindings.length&&<><h3>Lidhjet e ruajtura</h3>{bindings.map(b=><div key={b.deviceId}><p>{home.objects.find(o=>o.id===b.objectId)?.name??b.objectId} · Tuya {b.primaryProvider==='tuya'?'primary':'secondary'} · READ-ONLY</p><button type="button" className="secondary" disabled={busy} onClick={()=>{if(!window.confirm(`Hiq lidhjen Tuya nga ${home.objects.find(o=>o.id===b.objectId)?.name??b.objectId}?`))return;void run(async()=>{const next=await api<Home>('/tuya/unbind','POST',{objectId:b.objectId,expectedRevision:home.revision});onSave(next);setBindings(await api<Binding[]>('/tuya/bindings'));setMessage('Lidhja u hoq; objekti dhe media mbeten.');});}}>Hiq lidhjen</button></div>)}<button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{setSnapshot(await api<DeviceSnapshot>('/devices'));setMessage('Gjendja u lexua nga provider-i.');})}>Test · Read State</button>{snapshot&&<p>{snapshot.entities.filter(e=>e.source==='tuya').map(e=>`${e.name}: ${e.state}`).join(', ')||'Pa gjendje të lexueshme'}</p>}<button type="button" className="primary" onClick={onClose}>Save · Mbyll</button></>}
  <button type="button" className="secondary" onClick={onClose}>Kthehu te Integrations</button>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="inline-error">{error}</p>}
 </div></Dialog>;
}

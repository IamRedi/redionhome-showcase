import {useEffect,useState} from 'react';
import type {Home,DeviceSnapshot} from '../shared/model.ts';
import {api,errorText} from './api.ts';
import {Dialog} from './Dialog.tsx';
import {HomeAssistantSetup} from './HomeAssistantSetup.tsx';
import {TuyaSetup} from './TuyaSetup.tsx';
import {UnifiedDeviceCatalog} from './UnifiedDeviceCatalog.tsx';
import {ProductIntegrationCatalog} from './ProductIntegration.tsx';

type SmartThingsInfo={status:'AUTH_BLOCKED'|'DIAGNOSTIC_READ_ONLY';oauthRegistration:string;physicalCommands:false};
type SmartThingsDevice={deviceId:string;label?:string;name?:string;supportedCapabilities:string[]};
type Binding={deviceId:string;objectId:string;primaryProvider:string;externalId:string};

export function IntegrationsSetup({home,onClose,onSave,initialObjectId,initialProvider,onCreateObject}:{home:Home;onClose:()=>void;onSave:(home:Home)=>void;initialObjectId?:string;initialProvider?:'home-assistant'|'smartthings'|'tuya';onCreateObject?:()=>void}){
 const [provider,setProvider]=useState<'catalog'|'smartthings'|'home-assistant'|'tuya'>(initialProvider??(initialObjectId?'home-assistant':'catalog'));
 const [info,setInfo]=useState<SmartThingsInfo|null>(null),[devices,setDevices]=useState<SmartThingsDevice[]>([]),[bindings,setBindings]=useState<Binding[]>([]),[selected,setSelected]=useState(''),[objectId,setObjectId]=useState(''),[confirmed,setConfirmed]=useState(false),[snapshot,setSnapshot]=useState<DeviceSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{if(provider!=='smartthings')return;void Promise.all([api<SmartThingsInfo>('/smartthings'),api<Binding[]>('/smartthings/bindings')]).then(([i,b])=>{setInfo(i);setBindings(b);}).catch(e=>setError(errorText(e)));},[provider]);
 const run=async(task:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await task();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 const hotspots=home.objects.filter(o=>home.scenes.some(s=>s.hotspots.some(h=>h.objectId===o.id)));
 if(provider==='home-assistant')return <HomeAssistantSetup home={home} onClose={()=>setProvider('catalog')} onSave={onSave} initialObjectId={initialObjectId} onCreateObject={onCreateObject}/>;
 if(provider==='tuya')return <TuyaSetup home={home} onClose={()=>setProvider('catalog')} onSave={onSave}/>;
 return <Dialog title={provider==='catalog'?'Integrations':'SmartThings'} eyebrow="SETTINGS · INTEGRATIONS" onClose={onClose}>
  {provider==='catalog'?<div className="editor-form">
   <p className="muted">Zgjidhni platformën për të lidhur pajisjet me objektet në panoramë.</p>
   <button type="button" className="primary wide" onClick={()=>setProvider('home-assistant')}>Shiko pajisjet · Home Assistant</button>
   <button type="button" className="secondary wide" onClick={()=>setProvider('smartthings')}>SmartThings · lidhje direkte</button>
   <button type="button" className="secondary wide" onClick={()=>setProvider('tuya')}>Smart Life/Tuya · lidhje direkte</button>
   <p className="muted">Pajisjet Smart Life dhe LSC të lidhura me Home Assistant shfaqen në listën e tij. Hue, Zigbee, Matter dhe Google Home mbeten në plan.</p>
   <UnifiedDeviceCatalog/>
   <ProductIntegrationCatalog/>
  </div>:<div className="editor-form">
   <p role="status">{info?.status??'Kontrollim…'} · komanda fizike të bllokuara</p>
   <p>Connect Account me OAuth pret regjistrimin zyrtar të API Access App dhe një callback publik HTTPS të miratuar. Kjo instalim nuk e ekspozon Home Runtime.</p>
   <button type="button" className="secondary" disabled>Connect Account · BLOCKED</button>
   <p className="muted">Rruga diagnostike READ-ONLY shfaqet vetëm kur operatori ka konfiguruar një kredencial të përkohshëm në skedar privat backend. Tokeni nuk vendoset në browser.</p>
   <button type="button" className="secondary" disabled={busy||info?.status!=='DIAGNOSTIC_READ_ONLY'} onClick={()=>void run(async()=>{const found=await api<SmartThingsDevice[]>('/smartthings/discover');setDevices(found);setMessage(`${found.length} pajisje të lejuara u zbuluan. Discovery nuk jep autorizim për komandë.`);})}>Discover</button>
   {!!devices.length&&<><label>Select Device<select value={selected} onChange={e=>{setSelected(e.target.value);setConfirmed(false);}}><option value="">Zgjidhni pajisjen</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId} disabled={!d.supportedCapabilities.includes('power')}>{d.label??d.name??'Pajisje'} · {d.supportedCapabilities.includes('power')?'power READ-ONLY':'state not supported'} · {d.deviceId}</option>)}</select></label>
   <label>Bind to Object · hotspot në panoramë<select value={objectId} onChange={e=>{setObjectId(e.target.value);setConfirmed(false);}}><option value="">Zgjidhni objektin</option>{hotspots.map(o=><option key={o.id} value={o.id}>{o.name} · {home.rooms.find(r=>r.id===o.roomId)?.name}{o.provider?.active?` · existing ${o.provider.active}`:''}</option>)}</select></label>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Konfirmoj se kjo pajisje i përket këtij objekti fizik. Emri i ngjashëm nuk mjafton.</label>
   <button type="button" className="primary" disabled={busy||!selected||!objectId||!confirmed} onClick={()=>void run(async()=>{const next=await api<Home>('/smartthings/bind','POST',{objectId,deviceId:selected,expectedRevision:home.revision,confirmSamePhysicalDevice:true});onSave(next);setBindings(await api<Binding[]>('/smartthings/bindings'));setMessage('Identiteti u lidh. Shihni gjendjen READ-ONLY në objekt.');})}>Bind to Object</button></>}
   {!!bindings.length&&<><h3>Lidhjet e ruajtura</h3>{bindings.map(b=><div key={b.deviceId}><p>{home.objects.find(o=>o.id===b.objectId)?.name??b.objectId} · SmartThings {b.primaryProvider==='smartthings'?'primary':'secondary'} · READ-ONLY</p><button type="button" className="secondary" disabled={busy} onClick={()=>{if(!window.confirm(`Hiq lidhjen SmartThings nga ${home.objects.find(o=>o.id===b.objectId)?.name??b.objectId}?`))return;void run(async()=>{const next=await api<Home>('/smartthings/unbind','POST',{objectId:b.objectId,expectedRevision:home.revision});onSave(next);setBindings(await api<Binding[]>('/smartthings/bindings'));setMessage('Lidhja u hoq; objekti dhe media mbeten.');});}}>Hiq lidhjen</button></div>)}<button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{setSnapshot(await api<DeviceSnapshot>('/devices'));setMessage('Gjendja u lexua nga provider-i.');})}>Test · Read State</button>{snapshot&&<p>{snapshot.entities.filter(e=>e.source==='smartthings').map(e=>`${e.name}: ${e.state}`).join(', ')||'Pa gjendje të lexueshme'}</p>}<button type="button" className="primary" onClick={onClose}>Save · Mbyll</button></>}
   <button type="button" className="secondary" onClick={()=>setProvider('catalog')}>Kthehu te Integrations</button>
   {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="inline-error">{error}</p>}
  </div>}
 </Dialog>;
}

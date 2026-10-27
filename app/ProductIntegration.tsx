import {useEffect,useState} from 'react';
import {ExternalLink,RefreshCw} from 'lucide-react';
import type {HomeObject} from '../shared/model.ts';
import {productNames,type ProductId,type ProductReport} from '../shared/product-integrations.ts';
import {api,errorText} from './api.ts';

const statusLabels:Record<ProductReport['status'],string>={unconfigured:'Pa lidhje',online:'Burimi përgjigjet',degraded:'Me kufizime',offline:'Pa gjendje të freskët',identity_unverified:'Identitet i paverifikuar',identity_mismatch:'Identitet i ndryshuar',configuration_error:'Kontrolloni konfigurimin'};
const valueLabels:Record<string,string>={READY:'Gati',DISCONNECTED:'Shkëputur',CONNECTED:'Lidhur',IDLE:'Në pritje',on:'Ndezur',off:'Fikur',printing:'Në printim'};

export function ProductIntegration({object}:{object:HomeObject}){
 const [report,setReport]=useState<ProductReport|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[missing,setMissing]=useState(false);
 useEffect(()=>{const controller=new AbortController();void api<ProductReport>(`/product-integrations/${object.id}`,'GET',undefined,controller.signal).then(value=>{if(!controller.signal.aborted){setReport(value);setMissing(false);}}).catch(e=>{if(!controller.signal.aborted){if(e instanceof Error&&['PRODUCT_NOT_CONFIGURED','PRODUCT_OBJECT_NOT_FOUND'].includes(e.message))setMissing(true);else setError(errorText(e));}}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[object.id]);
 const refresh=async()=>{setBusy(true);setError('');try{setReport(await api<ProductReport>(`/product-integrations/${object.id}`));}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 if(missing)return null;
 return <section className="context-section product-integration" aria-label="Lidhja e produktit" aria-busy={busy}>
  <div className="product-integration-head"><h3>{report?.name??'Lidhja e produktit'}</h3><button type="button" className="icon-button" aria-label="Rilexo gjendjen e produktit" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={18}/></button></div>
  {busy&&!report&&<p role="status">Po lexoj lidhjen…</p>}
  {report&&<><span className={`product-status ${report.status}`}>{statusLabels[report.status]}</span><p>{report.message}</p>
   {report.launchUrl&&<a className="primary wide product-launch" href={report.launchUrl} target="_blank" rel="noopener noreferrer" onClick={()=>{void api(`/product-integrations/${object.id}/open`,'POST',{requestId:crypto.randomUUID()}).catch(()=>setError('Hapja u kërkua në shfletues, por regjistrimi nuk u konfirmua.'));}}>{report.launchLabel}<ExternalLink size={17}/></a>}
   {report.readings.length>0&&<dl className="device-values">{report.readings.map(reading=><div key={reading.label}><dt>{reading.label}{reading.sourceObservedAt&&<small className="product-observation-time">Përditësuar: {new Date(reading.sourceObservedAt).toLocaleString('sq-AL')}</small>}</dt><dd>{valueLabels[String(reading.value)]??reading.value}{reading.unit?` ${reading.unit}`:''}</dd></div>)}</dl>}
   {report.launchUrl?.startsWith('http:')&&window.location.protocol==='https:'&&<p className="muted">Hapet në faqe tjetër në rrjetin lokal. Telefoni duhet të ketë qasje në atë rrjet.</p>}
   {report.presets.length>0&&<details><summary>Preset-et e raportuara · {report.presets.length}</summary><p className="product-presets">{report.presets.join(' · ')}</p></details>}
   <details className="device-technical"><summary>Burimi dhe kufizimet</summary><p>Lexim: {new Date(report.receivedAt).toLocaleString('sq-AL')}. Rifreskimi ruhet deri 15 sekonda.</p>{report.readings.some(r=>!r.sourceObservedAt)&&<p>Koha e ndryshimit në burim nuk raportohet për disa vlera.</p>}<p>Identiteti fizik: {report.identityVerified?'përputhet me lidhjen':'i paverifikuar'}. Komanda fizike nga kjo kartë: të bllokuara.</p><p>Pa matje për: {report.unsupportedMetrics.join(', ')}.</p></details>
  </>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
 </section>;
}

export function ProductIntegrationCatalog(){
 const [items,setItems]=useState<{objectId:string;name:string;product:ProductId;configured:boolean}[]>([]),[error,setError]=useState('');
 useEffect(()=>{let canceled=false;void api<typeof items>('/product-integrations').then(v=>{if(!canceled)setItems(v);}).catch(e=>{if(!canceled)setError(errorText(e));});return()=>{canceled=true;};},[]);
 return <section className="context-section product-integration-catalog" aria-label="Produktet private"><h3>Produktet private</h3><p className="muted">Hapja e aplikacionit, gjendja dhe komandat verifikohen veçmas.</p>
  {(Object.entries(productNames) as [ProductId,string][]).map(([product,name])=>{const matches=items.filter(x=>x.product===product);return <div key={product} className="product-catalog-row"><strong>{name}</strong><span>{matches.length?matches.map(x=>`${x.name} · ${x.configured?'lidhje e konfiguruar':'pret konfigurim'}`).join(', '):'Pret lidhjen e saktë me objektin'}</span></div>;})}
  <p className="muted">Lidhjet e rrjetit vendosen në konfigurimin privat të serverit. PIN dhe kredenciale nuk kërkohen në bisedë.</p>{error&&<p role="alert">{error}</p>}
 </section>;
}

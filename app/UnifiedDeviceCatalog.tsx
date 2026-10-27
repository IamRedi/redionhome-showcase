import {useEffect,useState} from 'react';
import {RefreshCw,Search} from 'lucide-react';
import type {DeviceCapability,UnifiedDiscoveryReport} from '../shared/device-catalog.ts';
import {deviceCategoryLabel} from '../shared/device-catalog.ts';
import {api,errorText} from './api.ts';

type Filter='all'|'online'|'unavailable'|'linked';
const providerLabel=(provider:string)=>provider==='home-assistant'?'Home Assistant':provider==='smartthings'?'SmartThings':'Smart Life / Tuya';
const capabilityLabel:Record<DeviceCapability,string>={power:'Ndezje / fikje',brightness:'Ndriçim',color:'Ngjyrë',temperature:'Temperaturë',humidity:'Lagështi',energy:'Energji',position:'Pozicion',playback:'Luajtje',volume:'Volum',thermostat:'Termostat',telemetry:'Matje',lock:'Bravë','external-view':'Hap aplikacionin'};

export function UnifiedDeviceCatalog(){
  const [report,setReport]=useState<UnifiedDiscoveryReport|null>(null),[filter,setFilter]=useState<Filter>('all'),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;void api<UnifiedDiscoveryReport>('/unified-devices').then(value=>{if(active)setReport(value);}).catch(value=>{if(active)setError(errorText(value));});return()=>{active=false;};},[]);
  const discover=()=>{setBusy(true);setError('');void api<UnifiedDiscoveryReport>('/unified-devices/discover','POST').then(setReport).catch(value=>setError(errorText(value))).finally(()=>setBusy(false));};
  const rows=(report?.devices??[]).filter(device=>(filter==='all'||filter==='online'&&device.availability==='online'||filter==='unavailable'&&device.availability!=='online'||filter==='linked'&&!!device.objectId)&&(device.name+' '+device.category+' '+device.provider).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="unified-catalog" aria-label="Katalogu universal i pajisjeve">
    <div className="unified-heading"><div><h3>Katalogu universal</h3><p>Pajisjet nga platformat e lidhura, në një listë. Emrat e ngjashëm nuk bashkohen automatikisht.</p></div><button type="button" className="primary" disabled={busy} onClick={discover}><RefreshCw size={15}/>{busy?'Duke zbuluar…':report?.devices.length?'Rifresko të gjitha':'Zbulo të gjitha'}</button></div>
    {report&&<><div className="device-summary compact"><div><strong>{report.totals.devices}</strong><span>Gjithsej</span></div><div><strong>{report.totals.online}</strong><span>Online</span></div><div><strong>{report.totals.controllable}</strong><span>Me komandë</span></div><div><strong>{report.totals.linked}</strong><span>Në panoramë</span></div></div>
      {!!report.providers.length&&<div className="provider-results">{report.providers.map(provider=><span key={provider.provider} className={provider.status}>{providerLabel(provider.provider)} · {provider.status==='connected'?`${provider.discovered} pajisje`:provider.reason}</span>)}</div>}
      <div className="device-toolbar"><label><Search size={15}/><span className="search-label">Kërko</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Emri ose kategoria"/></label></div>
      <div className="device-filters" role="group" aria-label="Filtro katalogun">{([['all','Të gjitha'],['online','Online'],['unavailable','Pa lidhje'],['linked','Në panoramë']] as const).map(([id,label])=><button type="button" key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}</button>)}</div>
      <ul className="unified-device-list">{rows.map(device=><li key={`${device.provider}:${device.externalId}`}><div><strong>{device.name}</strong><small>{deviceCategoryLabel[device.category]} · {providerLabel(device.provider)}</small><span>{device.capabilities.length?device.capabilities.map(capability=>capabilityLabel[capability]).join(' · '):'Pa funksione të mbështetura'}{device.objectId?' · në panoramë':''}</span></div><div className="device-flags"><span className={`availability ${device.availability}`}>{device.availability==='online'?'Online':device.availability==='offline'?'Offline':device.availability==='unknown'?'Gjendje e panjohur':'Jo e disponueshme'}</span>{device.duplicateCandidate&&<span className="duplicate">Kontrollo dublikatën</span>}<details><summary>Detaje teknike</summary><code>{device.externalId}</code>{device.reason&&<p>{device.reason}</p>}</details></div></li>)}</ul>
      {!rows.length&&<p className="notice">{report.devices.length?'Nuk ka pajisje në këtë filtër.':'Katalogu është bosh. Zgjidh “Zbulo të gjitha”.'}</p>}
      {!!report.devices.length&&<p className="muted">Për vendosje: <strong>+ Shto → Pajisje Smart</strong>. Bravat, motorët dhe funksionet e rrezikshme mbeten vetëm për lexim.</p>}
    </>}
    {error&&<p role="alert" className="inline-error">{error}</p>}
  </section>;
}

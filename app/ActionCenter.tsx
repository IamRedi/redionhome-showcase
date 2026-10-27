import {useEffect,useRef,useState} from 'react';
import {Play,Square,Star} from 'lucide-react';
import type {Home} from '../shared/model.ts';
import type {RunStatus,ActionPolicy,ActionTarget,ActionRun,Ambient,HomeAction} from '../shared/actions.ts';
import {ApiError,api,errorText} from './api.ts';
import {Button} from './Button.tsx';

export type CenterSection='ambients'|'permissions'|'activity';
const statusLabel:Record<RunStatus,string>={awaiting_confirmation:'Pret konfirmim',running:'Po ekzekutohet',succeeded:'Gjendja u konfirmua',partial:'Përfundoi pjesërisht',failed:'Dështoi',stopped:'U ndal',interrupted:'U ndërpre nga rinisja',expired:'Kërkesa skadoi',blocked:'Nuk lejohet',uncertain:'Rezultati nuk u konfirmua'};
const actionLabel={turn_on:'Ndezje',turn_off:'Fikje',set_brightness:'Ndriçim'};
const stepLabel={pending:'Në pritje',dispatching:'Po dërgohet',confirmed:'Gjendja u konfirmua',failed:'Dështoi',uncertain:'Pa konfirmim',skipped:'Nuk u ekzekutua'};

export function RunResult({run}:{run:ActionRun}){
  return <section className={`run-result run-${run.status}`} aria-label="Rezultati i veprimeve">
    <strong role="status">{statusLabel[run.status]}</strong>
    <ol>{run.steps.map(step=><li key={step.index}><span>{step.name} · {actionLabel[step.command.action]}{step.command.brightness?` ${step.command.brightness}%`:''}</span><small>{stepLabel[step.status]}{step.provider==='mock'?' · MOCK':''}</small>{step.error&&<small>{errorText(new ApiError(409,step.error))}</small>}</li>)}</ol>
    {run.status==='stopped'&&<p className="muted">Hapat e padërguar u ndalën. Veprimet tashmë të dërguara mund të përfundojnë.</p>}
  </section>;
}

type GrantInput={objectId:string;actions:HomeAction['action'][];maxBrightness:number};
export function ActionCenter({section,home}:{section:CenterSection;home:Home}){
  const [policy,setPolicy]=useState<ActionPolicy>(),[targets,setTargets]=useState<ActionTarget[]>([]),[ambients,setAmbients]=useState<Ambient[]>([]),[runs,setRuns]=useState<ActionRun[]>([]);
  const [mode,setMode]=useState<ActionPolicy['mode']>('advise'),[duration,setDuration]=useState<ActionPolicy['duration']>('persistent'),[grants,setGrants]=useState<GrantInput[]>([]);
  const [name,setName]=useState(''),[roomId,setRoomId]=useState(home.rooms[0]?.id??''),[steps,setSteps]=useState<HomeAction[]>([]),[failureMode,setFailureMode]=useState<'stop'|'continue'>('stop');
  const createRef=useRef<HTMLDetailsElement>(null);
  const activeRequest=useRef<string|undefined>(undefined);
  const [editing,setEditing]=useState<Ambient>();
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[activeRun,setActiveRun]=useState<string>();
  const load=async()=>{
    const [p,t,a,r]=await Promise.all([api<ActionPolicy>('/action-policy'),api<ActionTarget[]>('/action-targets'),api<Ambient[]>('/ambients'),api<ActionRun[]>('/action-runs')]);
    setPolicy(p);setMode(p.mode);setDuration(p.duration);setGrants(p.grants.map(({objectId,actions,maxBrightness})=>({objectId,actions,maxBrightness})));setTargets(t);setAmbients(a);setRuns(r);
  };
  useEffect(()=>{let active=true;void load().catch(e=>{if(active)setError(errorText(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;if(activeRequest.current)void fetch('/api/v1/actions/stop-request',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:activeRequest.current}),keepalive:true}).catch(()=>undefined);};},[]);
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  const updatePolicy=async(revoke=false)=>{
    const next=await api<ActionPolicy>('/action-policy','PUT',{expectedVersion:policy!.version,mode:revoke?'advise':mode,duration,grants:revoke?[]:grants});setPolicy(next);setMode(next.mode);setGrants(next.grants.map(({objectId,actions,maxBrightness})=>({objectId,actions,maxBrightness})));setMessage(revoke?'Lejet u revokuan. Hapat e rinj do të refuzohen.':'Lejet u ruajtën.');
  };
  const runAmbient=async(ambient:Ambient)=>{
    if(policy?.mode==='confirm'&&!window.confirm(`Të aktivizohet “${ambient.name}” me ${ambient.steps.length} hapa?`))return;
    await act(async()=>{
      const requestId=crypto.randomUUID();
      // Publish request ID locally before dispatch, so Stop can race safely.
      setActiveRun(requestId);
      activeRequest.current=requestId;
      try{const run=await api<ActionRun>(`/ambients/${ambient.id}/run`,'POST',{requestId,expectedVersion:ambient.version,confirmed:policy?.mode==='confirm'});setRuns(current=>[run,...current.filter(r=>r.id!==run.id)]);}
      finally{activeRequest.current=undefined;setActiveRun(undefined);}
    });
  };
  const stopAmbient=()=>void api('/actions/stop-request','POST',{requestId:activeRun}).catch(e=>setError(errorText(e)));
  const toggleScope=(target:ActionTarget)=>setGrants(current=>current.some(g=>g.objectId===target.objectId)?current.filter(g=>g.objectId!==target.objectId):[...current,{objectId:target.objectId,actions:target.actions,maxBrightness:100}]);
  const patchScope=(id:string,patch:Partial<GrantInput>)=>setGrants(current=>current.map(g=>g.objectId===id?{...g,...patch}:g));
  const patchStep=(id:string,patch:Partial<HomeAction>)=>setSteps(current=>current.map(s=>s.objectId===id?{...s,...patch}:s));
  const saveAmbient=async(capture=false)=>{
    if(capture)await api('/ambients/capture','POST',{name,roomId,objectIds:steps.map(s=>s.objectId)});
    else await api('/ambients','POST',{name,roomId,steps,failureMode,...(editing?{id:editing.id,expectedVersion:editing.version,favorite:editing.favorite}:{})});
    setAmbients(await api<Ambient[]>('/ambients'));setMessage('Ambienti u ruajt. Ruajtja nuk aktivizon pajisje ose orare.');setName('');setSteps([]);setEditing(undefined);
  };
  if(loading)return <p role="status">Duke ngarkuar…</p>;
  return <section className="action-center">
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    {!policy&&<Button onClick={()=>void act(load)}>Riprovo</Button>}
    {policy&&section==='permissions'&&<>
      <h3>Si mund të veprojë R AI?</h3><p className="muted">Lejet vlejnë edhe për ambientet. Butonat manualë ruajnë lejet e tyre ekzistuese.</p>
      <label>Mënyra e lejes<select aria-label="Mënyra e lejes" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as ActionPolicy['mode'])}><option value="advise">Vetëm këshillon</option><option value="confirm">Pyet para veprimit</option><option value="auto">Ekzekuton brenda lejeve të mia</option></select></label>
      <label>Kohëzgjatja<select aria-label="Kohëzgjatja e lejes" value={duration} disabled={busy} onChange={e=>setDuration(e.target.value as ActionPolicy['duration'])}><option value="persistent">Deri në revokim</option><option value="session">Vetëm ky sesion</option></select></label>
      <p className="muted">Zgjidhni dritat e lidhura dhe veprimet që lejoni për secilën.</p>
      {targets.map(target=>{const grant=grants.find(g=>g.objectId===target.objectId);return <fieldset key={target.objectId} className="action-scope"><legend>{target.name}{target.provider==='mock'?' · MOCK':''}</legend><small className="muted">{target.available?'E disponueshme':'Pa lidhje ose pa kontroll të aktivizuar'}</small><label className="check-label"><input type="checkbox" checked={!!grant} disabled={busy||!grant&&!target.actions.length} onChange={()=>toggleScope(target)}/>Lejo {target.name}</label>{grant&&<><div className="scope-actions">{target.actions.map(action=><label key={action} className="check-label"><input type="checkbox" aria-label={`${target.name}: ${actionLabel[action]}`} checked={grant.actions.includes(action)} disabled={busy} onChange={e=>patchScope(target.objectId,{actions:e.target.checked?[...grant.actions,action]:grant.actions.filter(a=>a!==action)})}/>{actionLabel[action]}</label>)}</div>{target.actions.includes('set_brightness')&&<label>Kufiri i ndriçimit (%)<input aria-label={`Kufiri i ndriçimit: ${target.name}`} type="number" min="1" max="100" value={grant.maxBrightness} disabled={busy} onChange={e=>patchScope(target.objectId,{maxBrightness:Number(e.target.value)})}/></label>}</>}</fieldset>;})}
      {!targets.length&&<p className="notice">Nuk u gjetën drita të lidhura.</p>}
      <Button disabled={busy||grants.some(g=>!g.actions.length)} onClick={()=>void act(()=>updatePolicy())}>Ruaj lejet</Button>
      <Button onClick={()=>void updatePolicy(true).catch(e=>setError(errorText(e)))}>Revoko lejet</Button>
      <small className="muted">Ndryshimi i lidhjes së pajisjes kërkon leje të re.</small>
    </>}
    {section==='ambients'&&<>
      <h3>Ambientet e mia</h3><p className="muted">Përdorin hapa të ruajtur, pa kërkesë të re te modeli AI.</p>
      {runs[0]?.source==='ambient'&&<RunResult run={runs[0]}/>}
      {ambients.map(ambient=><article className="ambient-card" key={ambient.id}><div><strong>{ambient.name}</strong><small>{ambient.steps.length} hapa · versioni {ambient.version}</small></div><div className="ambient-controls"><button className="icon-button" aria-label={`Favorit: ${ambient.name}`} aria-pressed={ambient.favorite} disabled={busy} onClick={()=>void act(async()=>{await api(`/ambients/${ambient.id}`,'PATCH',{expectedVersion:ambient.version,favorite:!ambient.favorite});setAmbients(await api('/ambients'));})}><Star size={18} fill={ambient.favorite?'currentColor':'none'}/></button><Button aria-label={`Aktivizo ${ambient.name}`} disabled={busy||!policy||policy.mode==='advise'} onClick={()=>void runAmbient(ambient)}><Play size={15}/>Aktivizo</Button></div><details><summary>Hapat e ruajtur</summary><ul>{ambient.steps.map(step=><li key={step.command.objectId}>{step.name} · {actionLabel[step.command.action]}{step.command.brightness?` ${step.command.brightness}%`:''}</li>)}</ul><Button disabled={busy} onClick={()=>{setEditing(ambient);setName(ambient.name);setRoomId(ambient.roomId);setSteps(ambient.steps.map(s=>({...s.command})));setFailureMode(ambient.failureMode);if(createRef.current){createRef.current.open=true;createRef.current.scrollIntoView({block:'start'});}}}>Ndrysho ambientin</Button><Button disabled={busy} onClick={()=>{if(window.confirm(`Të hiqet ambienti “${ambient.name}”?`))void act(async()=>{await api(`/ambients/${ambient.id}`,'PATCH',{expectedVersion:ambient.version,deleted:true});setAmbients(await api('/ambients'));});}}>Hiq ambientin</Button></details></article>)}
      {!ambients.length&&<p className="notice">Ende nuk keni ambiente të ruajtura.</p>}
      {policy?.mode==='advise'&&<p className="muted">Aktivizimi bëhet i disponueshëm pasi të zgjidhni pajisjet dhe mënyrën te Lejet.</p>}
      {activeRun&&<Button onClick={stopAmbient}><Square size={14}/>Ndalo ambientin</Button>}
      <details ref={createRef} className="ambient-create"><summary>{editing?`Ndrysho: ${editing.name}`:'Krijo ambient manualisht'}</summary><form onSubmit={e=>{e.preventDefault();void act(()=>saveAmbient());}}>
        <label>Emri i ambientit<input aria-label="Emri i ambientit" disabled={busy} value={name} maxLength={80} required onChange={e=>setName(e.target.value)}/></label>
        <label>Dhoma<select aria-label="Dhoma e ambientit" disabled={busy} value={roomId} onChange={e=>{setRoomId(e.target.value);setSteps([]);}}>{home.rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {targets.filter(t=>t.roomId===roomId).map(target=>{const step=steps.find(s=>s.objectId===target.objectId);return <fieldset className="action-scope" key={target.objectId}><legend>{target.name}</legend><label className="check-label"><input type="checkbox" aria-label={`Përfshi ${target.name}`} disabled={busy||!step&&!target.actions.length} checked={!!step} onChange={e=>setSteps(current=>e.target.checked?[...current,{objectId:target.objectId,action:'turn_on'}]:current.filter(s=>s.objectId!==target.objectId))}/>Përfshi në ambient</label>{step&&<><label>Veprimi<select aria-label={`Veprimi: ${target.name}`} disabled={busy||!target.actions.length} value={step.action} onChange={e=>{const action=e.target.value as HomeAction['action'];setSteps(current=>current.map(s=>s.objectId===target.objectId?{objectId:s.objectId,action,...(action==='set_brightness'?{brightness:50}:{})}:s));}}>{target.actions.map(action=><option key={action} value={action}>{actionLabel[action]}</option>)}</select></label>{step.action==='set_brightness'&&<label>Ndriçimi (%)<input aria-label={`Ndriçimi: ${target.name}`} disabled={busy} type="number" min="1" max="100" value={step.brightness} onChange={e=>patchStep(target.objectId,{brightness:Number(e.target.value)})}/></label>}</>}</fieldset>;})}
        <label>Nëse një pajisje dështon<select aria-label="Sjellja në dështim" disabled={busy} value={failureMode} onChange={e=>setFailureMode(e.target.value as 'stop'|'continue')}><option value="stop">Ndalo hapat e tjerë</option><option value="continue">Vazhdo me pajisjet e tjera</option></select></label>
        <Button type="submit" disabled={busy||!steps.length||!name.trim()}>Ruaj ambientin</Button>
        {!editing&&<Button disabled={busy||!steps.length||!name.trim()} onClick={()=>void act(()=>saveAmbient(true))}>Ruaj gjendjen aktuale</Button>}{editing&&<Button disabled={busy} onClick={()=>{setEditing(undefined);setName('');setSteps([]);}}>Anulo ndryshimet</Button>}
      </form></details>
    </>}
    {section==='activity'&&<><h3>Aktiviteti</h3><Button disabled={busy} onClick={()=>void act(async()=>setRuns(await api('/action-runs')))}>Rifresko aktivitetin</Button>{!runs.length&&<p className="notice">Nuk ka veprime të regjistruara ende.</p>}{runs.map(run=><details className="activity-run" key={run.id}><summary>{statusLabel[run.status]} · {new Date(run.createdAt).toLocaleString('de-DE',{hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</summary><p className="muted">Nisësi: {run.actor} · {run.source==='ai'?'R AI':run.source==='ambient'?'Ambient':'Buton manual'} · {run.channel==='voice'?'Zë':run.channel==='text'?'Tekst':'Buton'}</p><RunResult run={run}/></details>)}</>}
  </section>;
}

import {useEffect,useRef,useState} from 'react';
import {Crosshair,Save,Trash2,History} from 'lucide-react';
import type {Home,HomeObject,Hotspot,Position} from '../shared/model.ts';
import {ApiError,api,errorText} from './api.ts';
import {ObjectFields} from './ObjectFields.tsx';
import {ProductDetail} from './ObjectPanels.tsx';
import {objectDraftSchema} from '../shared/drafts.ts';
import {Dialog} from './Dialog.tsx';
import {descendantIds} from '../shared/hierarchy.ts';
import {managedDevice,preserveDevice} from '../shared/editor.ts';
import {resolveObjectExperience} from '../shared/experience.ts';
type Props={home:Home;initialObjectId?:string;initialParentId?:string;initialKind?:'object'|'portal'|'inventory';sceneId:string;position:Position;picked:Position|null;placing:boolean;onPlace:()=>void;onClose:()=>void;onSave:(home:Home)=>void;onBindingSave?:(home:Home)=>void;onBuilder?:()=>void;onManageBinding?:(objectId:string,provider:'home-assistant'|'smartthings'|'tuya')=>void};
type Draft={selected:string;name:string;description:string;yaw:number;pitch:number;parentId:string;detailX:number;detailY:number;primary:'info'|'portal'|'device';target:string;actionChanged:boolean;detachMockLight:boolean;extensions:Partial<HomeObject>;roomName:string;sceneVisibility:'private'|'invited'|'public';mediaId:string};
const degrees=(r:number)=>Math.round(r*180/Math.PI*10)/10;
export function Editor({home,initialObjectId,initialParentId,initialKind='object',sceneId,position,picked,placing,onPlace,onClose,onSave,onBindingSave,onBuilder,onManageBinding}:Props){
 const [base,setBase]=useState(home),[busy,setBusy]=useState(false),[mediaBusy,setMediaBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[revisions,setRevisions]=useState<{revision:number;created_at:string}[]>([]),[preview,setPreview]=useState<{mode:'owner'|'visitor';object:HomeObject}|null>(null),[generation,setGeneration]=useState(0);
 const scene=base.scenes.find(s=>s.id===sceneId)!;
 const initialSelected=scene.hotspots.find(h=>h.objectId===initialObjectId)?.id??(initialObjectId&&initialObjectId!=='new'?`object:${initialObjectId}`:initialObjectId==='new'?'':scene.hotspots[0]?.id)??'';
 const makeDraft=(selected:string):Draft=>{
  const hotspot=scene.hotspots.find(h=>h.id===selected),o=base.objects.find(o=>o.id===(hotspot?.objectId??(selected.startsWith('object:')?selected.slice(7):'')));
  const action=managedDevice(o)?o?.actions.find(a=>a.type==='portal'||a.type==='info'):o?.actions[0];
  return {selected,name:o?.name??'',description:o?.description??'',yaw:degrees(hotspot?.position.yaw??position.yaw),pitch:degrees(hotspot?.position.pitch??position.pitch),parentId:o?.parentId??initialParentId??'',detailX:o?.detailPosition?.x??50,detailY:o?.detailPosition?.y??50,primary:action?.type==='portal'?'portal':action?.type==='device'?'device':!o&&initialKind==='portal'?'portal':'info',target:action?.type==='portal'?action.sceneId:base.scenes.find(s=>s.id!==sceneId)?.id??sceneId,actionChanged:!o&&initialKind==='portal',detachMockLight:false,extensions:!o&&initialKind==='inventory'?{category:'Inventar',kind:'generic',capabilities:['inventory']}: {},roomName:scene.name,sceneVisibility:scene.visibility??'private',mediaId:scene.mediaId};
 };
 const [draft,setDraft]=useState<Draft>(()=>makeDraft(initialSelected));
 const baseline=useRef(JSON.stringify(draft)),key=`redionhome-object-draft:${home.id}:${sceneId}`;
 const [missingObject,setMissingObject]=useState(false);
 const [recovery,setRecovery]=useState<string|null>(()=>sessionStorage.getItem(key));
 const dirty=JSON.stringify(draft)!==baseline.current;
 const patch=(fields:Partial<Draft>)=>setDraft(d=>({...d,...fields}));
 useEffect(()=>{if(picked)patch({yaw:degrees(picked.yaw),pitch:degrees(picked.pitch)});},[picked]);
 useEffect(()=>{if(dirty)sessionStorage.setItem(key,JSON.stringify({revision:base.revision,objectId:base.objects.find(o=>o.id===(scene.hotspots.find(h=>h.id===draft.selected)?.objectId??(draft.selected.startsWith('object:')?draft.selected.slice(7):'')))?.id,draft}));},[draft,base.revision]);
 useEffect(()=>{const protect=(e:BeforeUnloadEvent)=>{if(dirty||mediaBusy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',protect);return()=>window.removeEventListener('beforeunload',protect);},[dirty,mediaBusy]);
 const close=()=>{if((dirty||mediaBusy)&&!window.confirm('Ka ndryshime të paruajtura. Të mbyllet editori duke ruajtur draftin në këtë sesion?'))return;onClose();};
 const hotspot=scene.hotspots.find(h=>h.id===draft.selected),object=base.objects.find(o=>o.id===(hotspot?.objectId??(draft.selected.startsWith('object:')?draft.selected.slice(7):'')));
 const hasMockLight=!!object&&!object.provider?.active&&object.actions.some(action=>action.type==='device'&&action.bindingId==='demo-light');
 const managedProvider=managedDevice(object) ? object!.provider!.active as 'home-assistant'|'smartthings'|'tuya' : undefined;
 const candidate=():{object:HomeObject;hotspot?:Hotspot}=>{
  const primary:HomeObject['actions']=draft.primary==='portal'?[{type:'portal',sceneId:draft.target}]:draft.primary==='device'?[{type:'device',bindingId:'demo-light'}]:[{type:'info'}];
  const actions=object&&!draft.actionChanged?object.actions:[...primary,...(object?.actions.slice(1)??[])];
  const id=object?.id??crypto.randomUUID();
  const child=!!draft.parentId;
  const extensions=draft.extensions.actions?[...actions.filter(a=>!['demo','link','integration'].includes(a.type)),...draft.extensions.actions.filter(a=>['demo','link','integration'].includes(a.type))]:actions;
  const finalActions=draft.detachMockLight?extensions.filter(action=>!(action.type==='device'&&action.bindingId==='demo-light')):extensions;
  return {object:preserveDevice(object,{...object,...draft.extensions,id,roomId:scene.roomId,name:draft.name,description:draft.description,parentId:child?draft.parentId:undefined,detailPosition:child?{x:draft.detailX,y:draft.detailY}:undefined,actions:finalActions.length?finalActions:[{type:'info'}]}),hotspot:child?undefined:{id:hotspot?.id??crypto.randomUUID(),objectId:id,position:{yaw:draft.yaw*Math.PI/180,pitch:draft.pitch*Math.PI/180}}};
 };
 const commit=async(next:Home)=>{if(missingObject){setError('Objekti është hequr nga një sesion tjetër. Drafti mbetet në këtë sesion.');return;}setBusy(true);setError('');setConflict(false);try{const saved=await api<Home>('/home','PUT',next);sessionStorage.removeItem(key);onSave(saved);}catch(e){setConflict(e instanceof ApiError&&e.code==='REVISION_CONFLICT');setError(errorText(e));}finally{setBusy(false);}};
 const buildCandidate=()=>{const next=candidate();return {...base,objects:[...base.objects.filter(o=>o.id!==next.object.id),next.object],scenes:base.scenes.map(s=>s.id===sceneId?{...s,name:draft.roomName,visibility:draft.sceneVisibility,mediaId:draft.mediaId,hotspots:[...s.hotspots.filter(h=>h.objectId!==next.object.id&&h.id!==next.hotspot?.id),...(next.hotspot?[next.hotspot]:[])]}:s),rooms:base.rooms.map(r=>r.id===scene.roomId?{...r,name:draft.roomName}:r)};};
 const save=()=>void commit(buildCandidate());
 const openPreview=async(mode:'owner'|'visitor')=>{
  if(missingObject){setError('Objekti është hequr nga një sesion tjetër. Drafti mbetet në këtë sesion.');return;}
  setBusy(true);setError('');setConflict(false);
  try{const candidateHome=buildCandidate();const validated=await api<Home>('/home/validate','POST',candidateHome);
   const edited=validated.objects.find(o=>o.id===candidateHome.objects.at(-1)!.id)!;
   setPreview({mode,object:edited});
  }catch(e){setConflict(e instanceof ApiError&&e.code==='REVISION_CONFLICT');setError(errorText(e));}finally{setBusy(false);}
 };
 const previewObject=preview?.object;
 const visitorExperience=previewObject?resolveObjectExperience(previewObject,'showroom'):undefined;
 const visitorObject=visitorExperience?{...visitorExperience,experiences:undefined,provider:undefined,permissions:undefined,documents:previewObject!.documents?.filter(d=>d.visibility!=='private'),actions:visitorExperience.actions.filter(a=>['info','portal','demo','link','app'].includes(a.type))}:undefined;
 const [bindingTarget,setBindingTarget]=useState('');
 const changeBinding=async(operation:'detach'|'move')=>{
  if(!object||!window.confirm(operation==='detach'?'Të shkëputen lidhjet reale nga ky objekt? Objekti, mediat dhe drafti ruhen; pajisja nuk merr komandë.':'Të zhvendosen lidhjet reale te objekti i zgjedhur? Objekti i vjetër, mediat dhe drafti ruhen; pajisja nuk merr komandë.'))return;
  setBusy(true);setError('');
  try{const next=await api<Home>('/bindings/edit','POST',{objectId:object.id,expectedRevision:base.revision,operation,targetObjectId:operation==='move'?bindingTarget:undefined,confirm:true});
   setBase(next);onBindingSave?.(next);setDraft(d=>{
    const extensions={...d.extensions};delete extensions.provider;
    if(extensions.actions)extensions.actions=extensions.actions.filter(a=>a.type!=='device'&&a.type!=='integration');
    if(extensions.experiences?.private?.actions){const actions=extensions.experiences.private.actions.filter(a=>a.type!=='device'&&a.type!=='integration');extensions.experiences={...extensions.experiences,private:{...extensions.experiences.private,actions:actions.length?actions:[{type:'info'}]}};}
    return {...d,primary:d.primary==='device'?'info':d.primary,extensions};
   });
   setError('Lidhja u përditësua. Drafti mbeti; Ruaj ndryshimet për përmbajtjen.');
  }catch(e){setConflict(e instanceof ApiError&&e.code==='REVISION_CONFLICT');setError(errorText(e));}finally{setBusy(false);}
 };
 const blockedParents=new Set(object?[object.id,...descendantIds(base.objects,object.id)]:[]);
 const parentOptions=base.objects.filter(item=>item.roomId===scene.roomId&&!blockedParents.has(item.id));
 return <>
 <Dialog suspended={placing||!!preview} title="Formësoni hapësirën" eyebrow={`EDITOR · VERSIONI ${base.revision}`} onClose={close}>
  <form noValidate className="editor-form" onSubmit={e=>{e.preventDefault();save();}}>
   <p className="muted">Prekni vendin, shtoni fotografinë dhe emrin, pastaj Ruaj. Fotografia e panoramës mbetet e pandryshuar.</p>
   {recovery&&<div className="notice"><span>Ka një draft objekti të paruajtur.</span><button type="button" onClick={()=>{try{const restored=objectDraftSchema.parse(JSON.parse(recovery));setDraft(restored.objectId?{...restored.draft,selected:scene.hotspots.find(h=>h.objectId===restored.objectId)?.id??`object:${restored.objectId}`}:restored.draft);setMissingObject(!!restored.objectId&&!base.objects.some(o=>o.id===restored.objectId));setGeneration(g=>g+1);if(restored.revision!==base.revision)setError('Drafti është nga një version më i vjetër. Kontrollojeni kundrejt versionit aktual para ruajtjes.');}catch{setError('Drafti nuk u lexua.');}setRecovery(null);}}>Rikupero draftin</button><button type="button" onClick={()=>{sessionStorage.removeItem(key);setRecovery(null);}}>Hidh draftin</button></div>}
   <label>Hotspot-i<select aria-label="Hotspot-i" value={draft.selected} onChange={e=>{if(dirty&&!window.confirm('Të kaloj te objekti tjetër? Drafti aktual do të zëvendësohet.'))return;const next=makeDraft(e.target.value);baseline.current=JSON.stringify(next);setMissingObject(false);setDraft(next);setRecovery(null);sessionStorage.removeItem(key);}}><option value="">＋ Objekt i ri</option>{base.objects.filter(o=>o.roomId===scene.roomId&&!scene.hotspots.some(h=>h.objectId===o.id)).map(o=><option key={o.id} value={`object:${o.id}`}>Lidh objekt: {o.name}</option>)}{scene.hotspots.map(h=><option key={h.id} value={h.id}>{base.objects.find(o=>o.id===h.objectId)?.name}</option>)}</select></label>
   <label>Emri i objektit<input aria-label="Emri i objektit" value={draft.name} onChange={e=>patch({name:e.target.value})} required maxLength={120} placeholder="P.sh. Llamba pranë dritares"/></label>
   <label>Niveli / prindi<select aria-label="Niveli / prindi" disabled={!!managedProvider} value={draft.parentId} onChange={e=>patch({parentId:e.target.value})}><option value="">Panorama 360° · niveli kryesor</option>{parentOptions.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <label>Përshkrimi<textarea value={draft.description} onChange={e=>patch({description:e.target.value})} maxLength={2000} rows={3}/></label>
   <ObjectFields key={`${draft.selected}-${generation}`} object={object} fields={draft.extensions} bindingManaged={!!managedProvider} revision={base.revision} onChange={extensions=>patch({extensions})} onBusy={setMediaBusy} onSuggest={fields=>setDraft(d=>({...d,name:fields.name,description:fields.description,extensions:{...d.extensions,category:fields.category,photoSuggestionId:fields.photoSuggestionId}}))}/>
   {hasMockLight&&<div className="notice"><strong>Dritë testuese · MOCK</strong><p>Kjo është vetëm lidhje demonstrimi në këtë kandidat; nuk prek pajisje fizike ose Integrations.</p><button type="button" className="secondary" onClick={()=>patch(draft.detachMockLight?{detachMockLight:false,primary:'device',actionChanged:false}:{detachMockLight:true,primary:'info',actionChanged:true})}>{draft.detachMockLight?'Rikthe dritën testuese MOCK':'Shkëpute dritën testuese MOCK'}</button></div>}
   {managedProvider&&<div className="notice"><strong>Pajisja mbetet e lidhur · {managedProvider}</strong><p>Emri, fotografitë, përshkrimi dhe linket redaktohen pa shkëputje. Pozicioni ndryshohet me “Zgjidh pozicionin në panoramë”.</p><details><summary>Menaxho lidhjen reale</summary><p>Këto veprime ndryshojnë lidhjet e ruajtura, pa komanduar pajisjen. Objekti dhe mediat mbeten.</p><button type="button" className="secondary" disabled={busy||mediaBusy} onClick={()=>void changeBinding('detach')}>Shkëput lidhjen reale</button><label>Zhvendos lidhjen te objekti<select value={bindingTarget} onChange={e=>setBindingTarget(e.target.value)}><option value="">Zgjidh objektin</option>{base.objects.filter(o=>o.id!==object!.id&&!o.parentId&&!o.actions.some(a=>a.type==='device')&&o.provider?.status!=='configured'&&base.scenes.some(s=>s.hotspots.some(h=>h.objectId===o.id))).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button type="button" className="secondary" disabled={!bindingTarget||busy||mediaBusy} onClick={()=>void changeBinding('move')}>Zhvendos lidhjen reale</button>{onManageBinding&&<button type="button" className="secondary" onClick={()=>onManageBinding(object!.id,managedProvider)}>Hap Integrations për lidhjen</button>}</details></div>}
   {!draft.parentId&&<button type="button" className="secondary" onClick={onPlace}><Crosshair size={16}/>Zgjidh pozicionin në panoramë</button>}
   {draft.parentId&&<details><summary>Pozicioni mbi fotografinë e prindit</summary><div className="field-pair"><label>Majtas / djathtas (%)<input aria-label="Pozicioni horizontal" type="range" min="0" max="100" value={draft.detailX} onChange={e=>patch({detailX:Number(e.target.value)})}/></label><label>Lart / poshtë (%)<input aria-label="Pozicioni vertikal" type="range" min="0" max="100" value={draft.detailY} onChange={e=>patch({detailY:Number(e.target.value)})}/></label></div></details>}
   <label>Veprimi<select aria-label="Veprimi" value={draft.primary} onChange={e=>patch({primary:e.target.value as Draft['primary'],actionChanged:true})}><option value="info">Informacion</option><option value="portal">Kalim në një pamje</option>{!managedProvider&&<option value="device">Dritë demonstrimi · MOCK</option>}</select></label>
   {draft.primary==='portal'&&<label>Pamja e destinacionit<select value={draft.target} onChange={e=>patch({target:e.target.value,actionChanged:true})}>{base.scenes.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
   {!draft.parentId&&<details><summary>Pozicioni i saktë · opsional</summary><div className="field-pair"><label>Yaw (°)<input aria-label="Yaw" type="number" min={-360} max={360} step="0.1" value={draft.yaw} onChange={e=>patch({yaw:Number(e.target.value)})}/></label><label>Pitch (°)<input aria-label="Pitch" type="number" min={-90} max={90} step="0.1" value={draft.pitch} onChange={e=>patch({pitch:Number(e.target.value)})}/></label></div></details>}
   <label>Visibility e pamjes<select aria-label="Visibility e pamjes" value={draft.sceneVisibility} onChange={e=>patch({sceneVisibility:e.target.value as Draft['sceneVisibility']})}><option value="private">Private Only</option><option value="invited">Invited Tour</option><option value="public">Public Showcase</option></select></label>
   <div className="capture-actions"><button type="button" className="secondary" disabled={busy||mediaBusy} onClick={()=>void openPreview('owner')}>Preview si pronar</button><button type="button" className="secondary" disabled={busy||mediaBusy} onClick={()=>void openPreview('visitor')}>Preview si vizitor</button></div>
   <details><summary>Media & versionet</summary><label>Emri i pamjes<input value={draft.roomName} maxLength={120} required onChange={e=>patch({roomName:e.target.value})}/></label><p className="muted">Ndërroni panoramën nga Shtëpia & dhomat, me preview para ruajtjes. Objektet dhe historia ruhen.</p>{onBuilder&&<button type="button" className="secondary" onClick={()=>{if((dirty||mediaBusy)&&!window.confirm('Të hapen dhomat duke ruajtur draftin e objektit?'))return;onBuilder();}}>Hap Shtëpia & dhomat</button>}
    <button type="button" className="secondary" onClick={()=>void api<typeof revisions>('/revisions').then(setRevisions).catch(e=>setError(errorText(e)))}><History size={16}/>Shiko versionet</button>
    {revisions.map(r=><div className="revision" key={r.revision} role="group" aria-label={`Versioni ${r.revision}`}><span>Versioni {r.revision}<small>{r.created_at} UTC</small></span><button type="button" disabled={busy||r.revision===base.revision} onClick={()=>{if(dirty&&!window.confirm('Rikthimi do të zëvendësojë draftin aktual. Të vazhdoj?'))return;setBusy(true);void api<Home>('/restore','POST',{revision:r.revision,expectedRevision:base.revision}).then(next=>{sessionStorage.removeItem(key);onSave(next);}).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));}}>Rikthe</button></div>)}
   </details>
   {error&&<div className="inline-error" role="alert">{error}{conflict&&<button type="button" className="secondary" onClick={()=>void api<Home>('/home').then(latest=>{if(!latest.scenes.some(s=>s.id===sceneId)){setError('Dhoma nuk ekziston më. Drafti mbetet i ruajtur në këtë sesion.');return;}if(object){if(!latest.objects.some(o=>o.id===object.id)){setMissingObject(true);setError('Objekti është hequr nga një sesion tjetër. Drafti mbetet në këtë sesion.');return;}setDraft(d=>({...d,selected:latest.scenes.find(s=>s.id===sceneId)?.hotspots.find(h=>h.objectId===object.id)?.id??`object:${object.id}`}));}setBase(latest);setConflict(false);setError(`Versioni ${latest.revision} u ngarkua. Drafti juaj mbeti i paruajtur; kontrolloni fushat dhe shtypni Ruaj.`);}).catch(e=>setError(errorText(e)))}>Ngarko versionin e fundit, ruaj draftin tim</button>}</div>}
   <div className="editor-actions"><button className="primary" type="submit" disabled={busy||mediaBusy}><Save size={17}/>{busy?'Duke ruajtur…':'Ruaj ndryshimet'}</button>{hotspot&&<button type="button" className="icon-button danger" aria-label="Hiq hotspot-in" disabled={busy||mediaBusy||!!managedProvider} onClick={()=>{if(!window.confirm('Të hiqet ky hotspot? Objekti dhe historia ruhen.'))return;void commit({...base,scenes:base.scenes.map(s=>s.id===sceneId?{...s,hotspots:s.hotspots.filter(h=>h.id!==hotspot.id)}:s)});}}><Trash2 size={18}/></button>}</div>
   {dirty&&<p className="draft-status" role="status">Drafti ruhet në këtë sesion të shfletuesit; Ruaj krijon version të ri.</p>}
  </form>
 </Dialog>
 {preview&&<ProductDetail object={preview.mode==='visitor'?visitorObject!:previewObject!} children={[]} trail={[preview.mode==='visitor'?visitorObject!:previewObject!]} devices={null} role="public_viewer" tour={preview.mode==='visitor'} onClose={()=>setPreview(null)} onOpenChild={()=>undefined} onCommand={async()=>undefined} onNavigate={()=>setPreview(null)}/>}
 </>;
}

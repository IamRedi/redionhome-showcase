import { messages as m } from "./i18n/index.ts";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Eye,
  EyeOff,
  HelpCircle,
  Home as HomeIcon,
  Layers3,
  Lightbulb,
  LockKeyhole,
  LogOut,
  Maximize2,
  Minus,
  MousePointer2,
  MoveUpRight,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCog,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, errorText, mediaUrl, ApiError } from "./api.ts";
import { homeEndpoint, tourId } from "./api.ts";
import { ProductDetail } from "./ObjectPanels.tsx";
import { Publishing } from "./Publishing.tsx";
import { HomeBuilder } from './HomeBuilder.tsx';
import {PhoneAccess} from './PhoneAccess.tsx';
import {IntegrationsSetup} from './IntegrationsSetup.tsx';
import {AddFlow} from './AddFlow.tsx';
import {AIAssistant} from './AIAssistant.tsx';
import type {
  DeviceSnapshot,
  Home,
  Position,
  Role,
} from "../shared/model.ts";
import { Panorama, type PanoramaHandle } from "./Panorama.tsx";
import { Dialog } from "./Dialog.tsx";
import { Editor } from "./Editor.tsx";
import { childrenOf, objectTrail as buildObjectTrail, rootObject } from "../shared/hierarchy.ts";
import { canControlDevice, deviceForObject, isQuickToggleLight } from "./object-presentation.ts";
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <HomeIcon size={21} strokeWidth={1.6} />
      </span>
      <span>
        RediOn<span className="brand-light">Home</span>
        <small>YOUR SPACE. CONNECTED.</small>
      </span>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (role: Role) => void }) {
  const [password, setPassword] = useState(""),
    [username, setUsername] = useState("owner"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login">
      <div className="login-orbit orbit-one" />
      <div className="login-orbit orbit-two" />
      <Brand />
      <div className="login-content">
        <p className="eyebrow">NJË MËNYRË E RE PËR TË QENË NË SHTËPI</p>
        <h1>
          Hapësira juaj.
          <br />
          <em>Më afër se kurrë.</em>
        </h1>
        <p className="login-intro">
          Hyni, eksploroni dhe ndërveproni me hapësirën rreth jush. Gjithçka
          fillon në shtëpi.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void api<{ role: Role }>("/login", "POST", { username, password })
              .then((result) => onLogin(result.role))
              .catch((e) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Përdoruesi
            <select
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            >
              <option value="owner">Pronar</option>
              <option value="viewer">Vizitor</option>
            </select>
          </label>
          <label>
            Fjalëkalimi
            <input
              aria-label="Fjalëkalimi"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="Fjalëkalimi juaj lokal"
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Duke hyrë…" : "Hyni në hapësirën tuaj"}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="login-security">
          <LockKeyhole size={14} />
          Instalim lokal · Media private · Sesione private
        </p>
        <details className="login-help">
          <summary>Hyrja e parë?</summary>
          <p>
            Fjalëkalimi fillestar gjendet në skedarin privat{" "}
            <code>.data/owner-password.txt</code> në kompjuterin ku ekzekutohet
            serveri. Llogaria Vizitor krijohet me komandën lokale{" "}
            <code>user:create</code>.
          </p>
        </details>
      </div>
      <footer className="login-bottom">
        <span>REDIONHOME · LOCAL FIRST</span>
        <span>V0.1 / FOUNDATION</span>
      </footer>
    </main>
  );
}
function TourAccess({message,onReady}:{message:string;onReady:()=>void}){
 const [token,setToken]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <main className="login"><Brand/><div className="login-content"><p className="eyebrow">VIRTUAL TOUR</p><h1>Mirë se vini<span>.</span></h1><p className="login-description">Kjo përvojë kërkon një ftesë aktive ose miratimin e pronarit.</p><form className="login-form" onSubmit={e=>{e.preventDefault();setBusy(true);void api('/invitations/redeem','POST',{token}).then(onReady).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));}}><label>Kodi i ftesës<input value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" required/></label><button className="primary" disabled={busy}>Hap tour-in</button>{(error||message)&&<p role="alert">{error||message}</p>}</form></div></main>;
}
const oppositeYaw = (yaw: number) => {
  const fullTurn = Math.PI * 2;
  return ((yaw + Math.PI * 2) % fullTurn + fullTurn) % fullTurn - Math.PI;
};
export function App() {
  const compassIcon = useRef<SVGSVGElement>(null);
  const [role, setRole] = useState<Role | null>(null),
    [boot, setBoot] = useState(true),
    [home, setHome] = useState<Home | null>(null),
    [sceneId, setSceneId] = useState(""),
    [devices, setDevices] = useState<DeviceSnapshot | null>(null),
    [panel, setPanel] = useState<"objects" | "editor" | "help" | "publishing" | "builder" | "integrations" | "add" | "ai" | null>(null),
    [objectId, setObjectId] = useState<string | null>(null),
    [objectTrailIds, setObjectTrailIds] = useState<string[]>([]),
    [visible, setVisible] = useState(true),
    [sceneEntry, setSceneEntry] = useState<{sceneId:string;view:{position:Position;zoom:number}} | null>(null),
    [toast, setToast] = useState(""),
    [placing, setPlacing] = useState(false),
    [picked, setPicked] = useState<Position | null>(null),
    [uiHidden, setUiHidden] = useState(true),
    [editObjectId,setEditObjectId]=useState<string|undefined>(),
    [editParentId,setEditParentId]=useState<string|undefined>(),
    [integrationObjectId,setIntegrationObjectId]=useState<string|undefined>(),
    [integrationProvider,setIntegrationProvider]=useState<'home-assistant'|'smartthings'|'tuya'|undefined>(),
    [runtimeLabel,setRuntimeLabel]=useState<string|null>(null),
    [editMode,setEditMode]=useState(false),
    [editorKind,setEditorKind]=useState<'object'|'portal'|'inventory'>('object'),
    [adminMode,setAdminMode]=useState<boolean>(()=>{try{return localStorage.getItem('rdh-admin-mode')==='1';}catch{return false;}});
  const admin=role==='owner'&&!tourId&&adminMode;
  const toggleAdminMode=()=>{
    setAdminMode(value=>{
      const next=!value;
      try{localStorage.setItem('rdh-admin-mode',next?'1':'0');}catch{/* private mode preference only */}
      if(!next)setEditMode(false);
      return next;
    });
  };
  const panorama = useRef<PanoramaHandle>(null);
  const beforeObject=useRef<{position:Position;zoom:number}|null>(null);
  const sceneViews=useRef<Record<string,{position:Position;zoom:number}>>({});
  const closeObject=()=>{if(beforeObject.current)panorama.current?.restore(beforeObject.current);beforeObject.current=null;setObjectId(null);setObjectTrailIds([]);};
  const load = async () => {
    const h = await api<Home>(homeEndpoint);
    setHome(h);
    setSceneId((previous) =>
      h.scenes.some((s) => s.id === previous) ? previous : h.scenes[0].id,
    );
  };
  useEffect(() => {
    const start=async()=>{
      const invitation=new URLSearchParams(location.hash.slice(1)).get('invite');
      if(invitation){history.replaceState(null,'',location.pathname);await api('/invitations/redeem','POST',{token:invitation});}
      if(tourId){await load();setToast('');setRole('public_viewer');}
      else {const result=await api<{role:Role}>('/session');setRole(result.role);if(result.role==='owner'){const runtime=await api<{label:string|null}>('/runtime-info');setRuntimeLabel(runtime.label);}await load();}
    };
    const initialize=()=>void start().catch(e=>{if(!(e instanceof ApiError&&e.code==='AUTH_REQUIRED'))setToast(errorText(e));}).finally(()=>setBoot(false));
    const invitationChanged=()=>{if(new URLSearchParams(location.hash.slice(1)).has('invite')){setBoot(true);initialize();}};
    initialize();window.addEventListener('hashchange',invitationChanged);
    return ()=>window.removeEventListener('hashchange',invitationChanged);
  }, []);
  useEffect(()=>{
    if(!tourId||!role)return;
    const timer=setInterval(()=>{
      void api<Home>(homeEndpoint).catch(e=>{
        if(e instanceof ApiError&&(e.status===401||e.status===403)){
          setRole(null);setHome(null);setPanel(null);setObjectId(null);setObjectTrailIds([]);setToast(errorText(e));
        }
      });
    },4000);
    return ()=>clearInterval(timer);
  },[role]);
  useEffect(() => {
    if (!role || tourId) return;
    let cancelled = false;
    const poll = () =>
      void api<DeviceSnapshot>("/devices")
        .then((snapshot) => {
          if (!cancelled) setDevices(snapshot);
        })
        .catch((e) => {
          if (!cancelled) {
            setDevices((previous) =>
              previous
                ? {
                    ...previous,
                    connection: "offline",
                    entities: previous.entities.map((entity) => ({
                      ...entity,
                      state: "unavailable",
                    })),
                  }
                : null,
            );
            if (e instanceof ApiError && e.status === 401) {
              setRole(null);
              setHome(null);
            }
          }
        });
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [role]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlacing(false);
        setUiHidden(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const scene = home?.scenes.find((s) => s.id === sceneId),
    object = home?.objects.find((o) => o.id === objectId),
    trailObjects = home ? objectTrailIds.map(id => home.objects.find(item => item.id === id)).filter((item): item is Home['objects'][number] => !!item) : [];
  const navigate = (id: string) => {
    const currentView=panorama.current?.snapshot();
    if(currentView&&sceneId)sceneViews.current[sceneId]=currentView;
    const target = home?.scenes.find((candidate) => candidate.id === id);
    const returnPortal = target && home?.objects.find((candidate) =>
      candidate.roomId === target.roomId &&
      !candidate.parentId &&
      candidate.actions.some((action) => action.type === "portal" && action.sceneId === sceneId),
    );
    const returnHotspot = target?.hotspots.find((hotspot) => hotspot.objectId === returnPortal?.id);
    const remembered=target?sceneViews.current[target.id]:undefined;
    setSceneEntry(target ? {
      sceneId: target.id,
      view: remembered??{
        position:returnHotspot
          ? { yaw: oppositeYaw(returnHotspot.position.yaw), pitch: target.initial.pitch }
          : target.initial,
        zoom:15,
      },
    } : null);
    setSceneId(id);
    setObjectId(null);
    setObjectTrailIds([]);
    setPanel(null);
    setPlacing(false);
    setPicked(null);
  };
  const select = (id: string) => {
    const item = home?.objects.find((o) => o.id === id),
      root = home ? rootObject(home.objects, id) : undefined,
      hotspot = scene?.hotspots.find((h) => h.objectId === root?.id);
    if (!item) return;
    if(editMode&&role==='owner'&&!tourId){setEditObjectId(id);setPanel('editor');return;}
    const portal = item.actions.find((a) => a.type === "portal");
    if (portal?.type === "portal" && !item.parentId) {
      navigate(portal.sceneId);
      return;
    }
    if (hotspot) {beforeObject.current=panorama.current?.snapshot()??null;panorama.current?.focus(hotspot.position);}
    setObjectId(id);
    setObjectTrailIds(home ? buildObjectTrail(home.objects, id).map(entry => entry.id) : [id]);
    setPanel(null);
  };
  const openObjectFromAI=(id:string)=>{
    const item=home?.objects.find(candidate=>candidate.id===id),root=home?rootObject(home.objects,id):undefined;
    const target=home?.scenes.find(candidate=>candidate.hotspots.some(hotspot=>hotspot.objectId===root?.id));
    if(!item||!target)return;
    if(target.id!==sceneId)navigate(target.id);
    setObjectId(id);setObjectTrailIds(buildObjectTrail(home!.objects,id).map(entry=>entry.id));setPanel(null);
  };
  const openEditor = () => {
    setEditorKind('object');
    setEditObjectId(undefined);
    setEditParentId(undefined);
    setObjectId(null);
    setObjectTrailIds([]);
    setPicked(null);
    setPlacing(false);
    setPanel("editor");
  };
  const save = (next: Home) => {
    setHome(next);
    setPanel(null);
    setPicked(null);
    setPlacing(false);
    setToast(`Konfigurimi u ruajt · Versioni ${next.revision}`);
  };
  const commandDevice = async (id: string, on: boolean, brightness?: number) => {
    const item = home?.objects.find(candidate => candidate.id === id);
    if (!item || !role) throw new Error('Kontrolli nuk është i disponueshëm për këtë objekt.');
    const entity = deviceForObject(item, devices);
    if (!canControlDevice(entity, role)) throw new Error('Kontrolli nuk është i disponueshëm për këtë objekt.');
    const exact = entity?.source === 'home-assistant' ? entity.entityId : undefined;
    setDevices(await api<DeviceSnapshot>("/commands", "POST", { objectId: id, action: brightness !== undefined ? 'set_brightness' : on ? 'turn_on' : 'turn_off', ...(brightness !== undefined ? { brightness } : {}), ...(exact ? { confirmEntityId: exact } : {}) }));
  };
  if (boot)
    return (
      <main className="boot">
        <Brand />
        <span className="loader-ring" />
      </main>
    );
  if (!role && tourId) return <TourAccess message={toast} onReady={()=>void load().then(()=>{setToast('');setRole('public_viewer');}).catch(e=>setToast(errorText(e)))}/>;
  if (!role)
    return (
      <Login
        onLogin={(nextRole) => {
          setRole(nextRole);
          void load().catch((e) => setToast(errorText(e)));
        }}
      />
    );
  if (!home || !scene)
    return (
      <main className="boot">
        <Brand />
        <p role="alert">Hapësira nuk u ngarkua.</p>
        <button
          className="primary"
          onClick={() => void load().catch((e) => setToast(errorText(e)))}
        >
          Riprovo
        </button>
        {toast && <p role="alert">{toast}</p>}
      </main>
    );
  const realDevices=devices?.entities.filter(e=>e.source!=='mock')??[],
    online = realDevices.length?realDevices.some(e=>e.state!=='unavailable'):devices?.connection === "online";
  return (
    <main className={`experience ${uiHidden ? "ui-hidden" : ""}`}>
      {panel!=='builder'&&<Panorama
        ref={panorama}
        scene={scene}
        entryView={sceneEntry?.sceneId === scene.id ? sceneEntry.view : undefined}
        objects={home.objects}
        devices={devices}
        role={role}
        visible={visible && !uiHidden && !placing}
        placing={placing}
        editing={!uiHidden&&editMode&&panel===null&&!objectId}
        onSelect={select}
        onQuickToggle={(id) => {
          const item = home.objects.find(candidate => candidate.id === id);
          const device = item ? deviceForObject(item, devices) : undefined;
          if (!item || !isQuickToggleLight(item, device, role)) {
            select(id);
            return;
          }
          void commandDevice(id, device?.state !== 'on').catch(error => setToast(errorText(error)));
        }}
        onPlace={(position) => {
          setPicked(position);
          if(!placing&&editMode){setEditObjectId('new');setPanel('editor');}
          setPlacing(false);
        }}
        onYaw={yaw => { if (compassIcon.current) compassIcon.current.style.transform = `rotate(${(-yaw * 180) / Math.PI}deg)`; }}
        onError={setToast}
      />}
      <div className="scene-shade" />
      {editMode&&<div className="edit-banner"><span>Prekni objektin ose një vend bosh</span><button onClick={()=>{setEditObjectId('new');setPanel('editor');}}>＋ Objekt i ri</button><button onClick={()=>setEditMode(false)}>Mbarova</button></div>}
      <header className="topbar">
        <button className="brand-toggle" data-testid="brand-toggle" aria-label={uiHidden ? m.showInterface : 'Fshih ndërfaqen'} aria-expanded={!uiHidden} title="RediOnHome · shfaq / fshih kontrollet" onClick={() => setUiHidden(!uiHidden)}><Brand /></button>
        <div className="top-actions chrome">
          <span className={`connection ${online ? "" : "disconnected"}`}>
            {online ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span>
              {tourId ? "VIRTUAL TOUR" : realDevices.length ? online ? "PAJISJE LIVE" : "PAJISJE PA GJENDJE" : devices?.mode === "mock" ? "DEMO · MOCK" : "PA LIDHJE"}
            </span>
            <i />
          </span>
          <button
            className="icon-button"
            aria-label={m.logout}
            title={m.logout}
            onClick={() => tourId ? location.assign('/') :
              void api("/logout", "POST")
                .then(() => {for(const key of Object.keys(sessionStorage))if(key.startsWith('redionhome-'))sessionStorage.removeItem(key);location.reload();})
                .catch((e) => setToast(errorText(e)))
            }
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {runtimeLabel&&<div className="edit-banner" role="status"><span>{runtimeLabel}</span></div>}
      {admin&&<button className="admin-active-chip" aria-label="Modaliteti admin aktiv — prek për ta fikur" onClick={toggleAdminMode}><UserCog size={13}/>ADMIN AKTIVE ✕</button>}
      <nav className="side-rail chrome" aria-label={m.spaceTools}>
        <button
          className={panel === "objects" ? "active" : ""}
          aria-label={m.objects}
          title={m.objects}
          onClick={() => {
            setPanel("objects");
            setObjectId(null);
            setObjectTrailIds([]);
          }}
        >
          <Layers3 size={21} />
          <span>Objektet</span>
        </button>
        {admin&&<button className={panel==='add'?'active':''} aria-label="+ Shto" title="+ Shto" onClick={()=>{setObjectId(null);setObjectTrailIds([]);setPicked(null);setEditMode(false);setPanel('add');}}><Plus size={21}/><span>Shto</span></button>}
        {admin&&<button aria-label="Edit me prekje" title="Edit me prekje" className={editMode?'active':''} onClick={()=>{setEditMode(!editMode);setObjectId(null);setObjectTrailIds([]);setPanel(null);}}><MousePointer2 size={21}/><span>Edit</span></button>}
        {admin&&<button aria-label="Tour & ftesat" title="Tour & ftesat" onClick={()=>setPanel('publishing')}><ShieldCheck size={21}/><span>Tour</span></button>}
        {admin&&<button aria-label="Settings · Integrations" title="Settings · Integrations" onClick={()=>{setObjectId(null);setIntegrationObjectId(undefined);setPanel('integrations');}}><Settings2 size={21}/><span>Settings</span></button>}
        {role==='owner'&&!tourId&&<button className={panel==='ai'?'active':''} aria-label="AI RediOnHome" title="AI RediOnHome" onClick={()=>{setObjectId(null);setObjectTrailIds([]);setPanel('ai');}}><Sparkles size={21}/><span>AI</span></button>}
        <div className="rail-divider" />
        <button
          aria-label={visible ? m.hideHotspots : m.showHotspots}
          title={visible ? m.hideHotspots : m.showHotspots}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <Eye size={20} /> : <EyeOff size={20} />}
          <span>Hotspot</span>
        </button>
        <button
          aria-label={m.help}
          title={m.help}
          onClick={() => {
            setPanel("help");
            setObjectId(null);
            setObjectTrailIds([]);
          }}
        >
          <HelpCircle size={20} />
          <span>Ndihmë</span>
        </button>
        {role==='owner'&&!tourId&&<button className={`admin-toggle ${adminMode?'active':''}`} aria-label="Modaliteti admin" aria-pressed={adminMode} title="Modaliteti admin" onClick={toggleAdminMode}><UserCog size={17}/><span>Admin</span></button>}
      </nav>
      <div className="scene-meta chrome">
        <p className="eyebrow">
          <span className="live-dot" />
          {home.name.toLocaleUpperCase("sq")} <span className="meta-slash">/</span> 360°
        </p>
        <h1>
          {scene.name}
          <span>.</span>
        </h1>
      </div>
      <div className="bottom-center chrome">
        <nav className="scene-picker" aria-label={m.scenes}>
          {home.scenes.map((s, index) => (
            <button
              className={`scene-card ${s.id === sceneId ? "selected" : ""}`}
              key={s.id}
              onClick={() => navigate(s.id)}
              aria-current={s.id === sceneId ? "location" : undefined}
            >
              <img src={mediaUrl(s.mediaId)} alt="" />
              <div className="scene-card-shade" />
              <span className="scene-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="scene-card-name">{s.name}</span>
              {s.id === sceneId ? (
                <span className="card-selected">
                  <Check size={12} />
                </span>
              ) : (
                <MoveUpRight size={16} className="card-arrow" />
              )}
            </button>
          ))}
        </nav>
      </div>
      <aside className="view-controls chrome" aria-label={m.viewControls}>
        <div className="compass" aria-label="Orientimi i kamerës">
          <span className="compass-n">N</span>
          <Compass
            size={42}
            strokeWidth={0.8}
            ref={compassIcon}
          />
          <span className="compass-dot" />
        </div>
        <div className="view-buttons">
          <button
            aria-label={m.zoomOut}
            onClick={() => panorama.current?.zoom(-10)}
          >
            <Minus size={18} />
          </button>
          <span />
          <button
            aria-label={m.zoomIn}
            onClick={() => panorama.current?.zoom(10)}
          >
            <Plus size={18} />
          </button>
          <span />
          <button
            aria-label={m.resetView}
            onClick={() => panorama.current?.reset()}
          >
            <RotateCcw size={16} />
          </button>
          <span />
          <button
            aria-label={m.fullscreen}
            onClick={() => panorama.current?.fullscreen()}
          >
            <Maximize2 size={16} />
          </button>
        </div>
        <div className="rotate-buttons">
          <button
            aria-label={m.rotateLeft}
            onClick={() => {
              const p = panorama.current?.position();
              if (p) panorama.current?.focus({ ...p, yaw: p.yaw - 0.3 });
            }}
          >
            <ArrowLeft size={15} />
          </button>
          <span>360°</span>
          <button
            aria-label={m.rotateRight}
            onClick={() => {
              const p = panorama.current?.position();
              if (p) panorama.current?.focus({ ...p, yaw: p.yaw + 0.3 });
            }}
          >
            <ArrowRight size={15} />
          </button>
        </div>
      </aside>
      {placing && (
        <div className="placement-banner" role="status">
          <MousePointer2 size={18} />
          Klikoni pozicionin e objektit në panoramë
          <button onClick={() => setPlacing(false)}>Anulo</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {panel==='publishing'&&!tourId&&role==='owner'&&<Publishing home={home} onClose={()=>setPanel(null)}/>}
      {panel==='builder'&&!tourId&&role==='owner'&&<HomeBuilder home={home} onClose={()=>setPanel(null)} onSave={(next,id)=>{save(next);setSceneId(id);setEditMode(true);}}/>}
      {panel==='add'&&!tourId&&role==='owner'&&<AddFlow home={home} sceneId={sceneId} picked={picked} placing={placing} onPlace={()=>setPlacing(true)} onScene={id=>{setSceneId(id);setPicked(null);}} onClose={()=>{setPanel(null);setPlacing(false);setPicked(null);}} onSave={(next,id)=>{setHome(next);setPanel(null);setObjectId(id);setObjectTrailIds(buildObjectTrail(next.objects,id).map(item=>item.id));setPicked(null);setPlacing(false);setToast(`Pajisja u shtua · Versioni ${next.revision}`);void api<DeviceSnapshot>('/devices').then(setDevices).catch(()=>undefined);}} onEditor={kind=>{setPanel('editor');setEditObjectId('new');setEditParentId(undefined);setEditorKind(kind);setPicked(null);}} onBuilder={()=>{setPanel('builder');setPicked(null);}}/>}
      {panel==='integrations'&&!tourId&&role==='owner'&&<IntegrationsSetup home={home} onClose={()=>{setPanel(null);setIntegrationObjectId(undefined);setIntegrationProvider(undefined);}} onSave={next=>{setHome(next);setToast(`Lidhja u ruajt · Versioni ${next.revision}`);}} initialObjectId={integrationObjectId} initialProvider={integrationProvider} onCreateObject={()=>{setIntegrationObjectId(undefined);setIntegrationProvider(undefined);setEditObjectId('new');setEditMode(true);setPanel('editor');}}/>}
      {panel==='ai'&&!tourId&&role==='owner'&&<AIAssistant home={home} onClose={()=>setPanel(null)} onNavigate={navigate} onOpenObject={openObjectFromAI} onDevices={setDevices}/>}
      {object && (
        <ProductDetail
          key={object.id}
          object={object}
          tour={!!tourId}
          devices={devices}
          role={role}
          children={childrenOf(home.objects, object.id)}
          trail={trailObjects}
          onClose={closeObject}
          onBack={objectTrailIds.length>1?()=>{const next=objectTrailIds.slice(0,-1);setObjectTrailIds(next);setObjectId(next.at(-1)??null);}:undefined}
          onOpenChild={id=>{const child=home.objects.find(item=>item.id===id);if(child?.parentId!==object.id)return;setObjectTrailIds(current=>[...current,id]);setObjectId(id);}}
          onEdit={admin?()=>{closeObject();setEditObjectId(object.id);setEditParentId(undefined);setPanel('editor');}:undefined}
          onAddChild={admin?()=>{const parent=object.id;closeObject();setEditObjectId('new');setEditParentId(parent);setEditorKind('object');setPanel('editor');}:undefined}
          onConnectDevice={admin&&['home-assistant','smartthings','tuya'].includes(object.provider?.active??'')?()=>{const provider=object.provider!.active as 'home-assistant'|'smartthings'|'tuya';closeObject();setIntegrationObjectId(object.id);setIntegrationProvider(provider);setPanel('integrations');}:undefined}
          onNavigate={navigate}
          onCommand={commandDevice}
        />
      )}
      {panel === "objects" && (
        <Dialog
          title={m.objects}
          eyebrow={`${scene.name} · ${scene.hotspots.length} PIKA`}
          onClose={() => setPanel(null)}
        >
          <p className="muted">
            Zgjidhni një objekt për ta fokusuar ose një lidhje për të kaluar në
            pamjen tjetër.
          </p>
          <div className="object-list">
            {scene.hotspots.map((h) => {
              const o = home.objects.find((item) => item.id === h.objectId)!;
              return (
                <button key={h.id} onClick={() => select(o.id)}>
                  <span className="list-icon">
                    {o.actions.some((a) => a.type === "device") ? (
                      <Lightbulb size={20} />
                    ) : o.actions.some((a) => a.type === "portal") ? (
                      <MoveUpRight size={20} />
                    ) : (
                      <Layers3 size={20} />
                    )}
                  </span>
                  <span>
                    <strong>{o.name}</strong>
                    <small>
                      {o.actions.some((a) => a.type === "device")
                        ? (()=>{const action=o.actions.find(a=>a.type==='device');const entity=action?.type==='device'?devices?.entities.find(e=>e.bindingId===action.bindingId):undefined;return entity?.source==='home-assistant'?'Pajisje · Home Assistant':entity?.source==='smartthings'?'Pajisje · SmartThings':entity?.source==='tuya'?'Pajisje · Smart Life/Tuya':'Pajisje demonstrimi · MOCK';})()
                        : o.actions.some((a) => a.type === "portal")
                          ? "Kalim në dhomë"
                          : "Informacion & media"}
                    </small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </div>
          {role === "owner" && !tourId && (
            <button className="secondary wide" onClick={openEditor}>
              <Plus size={16} />
              Shtoni ose ndryshoni objekte
            </button>
          )}
        </Dialog>
      )}
      {panel === "editor" && (
        <Editor
          key={`${scene.id}-${editObjectId}`}
          home={home}
          initialObjectId={editObjectId}
          initialParentId={editParentId}
          initialKind={editorKind}
          sceneId={sceneId}
          position={panorama.current?.position() ?? scene.initial}
          picked={picked}
          placing={placing}
          onPlace={() => setPlacing(true)}
          onClose={() => {
            setPanel(null);
            setPlacing(false);
            setPicked(null);
          }}
          onSave={save}
          onBindingSave={setHome}
          onBuilder={()=>setPanel('builder')}
          onManageBinding={(id,provider)=>{setIntegrationObjectId(id);setIntegrationProvider(provider);setPanel('integrations');}}
        />
      )}
      {panel === "help" && (
        <Dialog
          title="Hyni në hapësirën tuaj"
          eyebrow="REDIONHOME · 360°"
          onClose={() => setPanel(null)}
        >
          <div className="help-step">
            <span>01</span>
            <div>
              <h3>Shikoni përreth</h3>
              <p>
                Tërhiqni me mouse ose prekje. Përdorni scroll, pinch ose butonat
                për zoom. Butonat majtas/djathtas ofrojnë navigim me tastierë.
              </p>
            </div>
          </div>
          <div className="help-step">
            <span>02</span>
            <div>
              <h3>Prekni një pikë</h3>
              <p>
                Hotspot-et hapin informacion dhe kontrolle kontekstuale.
                Shigjetat lidhin pamjet. Lista e objekteve është gjithmonë e
                arritshme nga tastiera.
              </p>
            </div>
          </div>
          <div className="help-step">
            <span>03</span>
            <div>
              <h3>Bëjeni tuajën</h3>
              <p>
                Editor-i ruan objekte, pozicione dhe versione. Origjinalet e
                panoramave mbeten të pandryshuara.
              </p>
            </div>
          </div>
          <div className="notice">
            <ShieldCheck size={20} />
            <p>
              Objektet shtohen mbi fotografitë origjinale. Simulimet virtuale janë të izoluara.
              Integrimet fizike janë ende të pakonfiguruara; kontrollet e disponueshme janë MOCK.
            </p>
          </div>
          {role==='owner'&&!tourId&&<PhoneAccess/>}
        </Dialog>
      )}
    </main>
  );
}

import { useState } from 'react';
import { Maximize2, X, ArrowRight, Link, ArrowLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import type { HomeObject, DeviceSnapshot, Role, ShowcaseCard } from '../shared/model.ts';
import { mediaUrl, errorText } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { canControlDevice, deviceForObject, objectIconMarkup, objectKind, objectKindLabel } from './object-presentation.ts';
import { resolveObjectExperience } from '../shared/experience.ts';

function ObjectGlyph({ object }: { object: HomeObject }) {
  return <span className="object-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: objectIconMarkup[objectKind(object)] }} /></span>;
}

export function Gallery({ ids, name, children, onOpenChild }: {
  ids: string[];
  name: string;
  children?: HomeObject[];
  onOpenChild?: (id: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState<number | null>(null);
  if (!ids.length) return null;
  const move = (direction: -1 | 1) => setFullscreen(current => current === null ? current : (current + direction + ids.length) % ids.length);
  return <section className="product-gallery" aria-label="Galeria e objektit">
    <div className="detail-stage">
      <img className="object-image" src={mediaUrl(ids[index] ?? ids[0])} alt={`${name} · ${index + 1}`} />
      {children?.map((child, childIndex) => {
        const point = child.detailPosition ?? { x: 18 + (childIndex % 3) * 31, y: 30 + (childIndex % 2) * 34 };
        return <button
          key={child.id}
          className="detail-pin"
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          aria-label={`Hap ${child.name}`}
          onClick={() => onOpenChild?.(child.id)}
        ><ObjectGlyph object={child}/><span>{child.name}</span></button>;
      })}
      <button className="gallery-expand icon-button" title="Hap galerinë" aria-label="Hap galerinë art në ekran të plotë" onClick={() => setFullscreen(index)}><Maximize2 size={20}/></button>
    </div>
    {ids.length > 1 && <div className="gallery-strip">{ids.map((id, i) => <button key={`${id}-${i}`} aria-label={`Fotografia ${i + 1}`} aria-pressed={index === i} onClick={() => setIndex(i)}><img src={mediaUrl(id)} alt="" /></button>)}</div>}
    {fullscreen !== null && <div className="gallery-fullscreen" role="dialog" aria-label={`Galeria art · ${name}`} tabIndex={-1} autoFocus
      onKeyDown={event => { if (event.key === 'Escape') setFullscreen(null); if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); }}
      onClick={event => { if (event.target === event.currentTarget) setFullscreen(null); }}>
      <img src={mediaUrl(ids[fullscreen])} alt={`${name} · ${fullscreen + 1}`} />
      <div className="gallery-fullscreen-bar">
        <button aria-label="Fotografia e mëparshme" disabled={ids.length < 2} onClick={() => move(-1)}><ArrowLeft size={20}/></button>
        <span>{fullscreen + 1} / {ids.length} · {name}</span>
        <button aria-label="Fotografia tjetër" disabled={ids.length < 2} onClick={() => move(1)}><ArrowRight size={20}/></button>
        <button aria-label="Mbyll galerinë art" onClick={() => setFullscreen(null)}><X size={20}/></button>
      </div>
    </div>}
  </section>;
}

export function VideoPresentation({ id }: { id: string }) {
  return <section className="context-section"><h3>Prezantim video</h3><video className="product-video" controls playsInline preload="metadata" src={mediaUrl(id, 'video.mp4')} /></section>;
}

export function TechnicalSpecifications({ items }: { items: NonNullable<HomeObject['specifications']> }) {
  return items.length ? <section className="context-section"><h3>Specifikimet</h3><dl className="specifications">{items.map((s, i) => <div key={i}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl></section> : null;
}

export function VirtualDemo({ kind }: { kind: 'piano' | 'led-wall' | 'robot' | 'fridge' }) {
  const [color, setColor] = useState('#c7deb5'), [effect, setEffect] = useState('static'), [note, setNote] = useState(-1), [gesture, setGesture] = useState(false), [door, setDoor] = useState<'closed' | 'open'>('closed');
  return <section className="virtual-demo" aria-label="Demonstrim virtual">
    <div className="demo-caption"><strong>DEMO VIRTUALE</strong><span>Simulim lokal · pa lidhje me pajisje</span></div>
    {kind === 'piano' ? <><p>Prek tastet për të ndezur LED-in virtual. Nuk dërgohet MIDI.</p><div className="virtual-keys">{['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si', 'Do′'].map((label, i) => <button key={i} className={note === i ? 'lit' : ''} aria-label={`Tasti virtual ${label}`} aria-pressed={note === i} onClick={() => setNote(i)}>{label}</button>)}</div></> : kind === 'led-wall' ? <><div className={`virtual-wall ${effect}`} style={{ '--demo-color': color } as React.CSSProperties}>{Array.from({ length: 48 }, (_, i) => <i key={i} />)}</div><label>Ngjyra virtuale<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label><label>Efekti virtual<select aria-label="Efekti virtual" value={effect} onChange={e => setEffect(e.target.value)}><option value="static">Ngjyrë e plotë</option><option value="pulse">Pulsim</option><option value="wave">Valë</option></select></label></> : kind === 'fridge' ? <><div className={`virtual-fridge ${door}`} data-state={door}><div className="fridge-cabinet" aria-hidden="true"><div className="fridge-interior"><i /><i /><i /></div><div className="fridge-door"><span className="fridge-handle" /></div></div></div><p>Tranzicion i çiftuar hap/mbyll i fotografive të brendësisë. Asnjë komandë fizike nuk dërgohet.</p><button className="secondary" aria-pressed={door === 'open'} onClick={() => setDoor(door === 'closed' ? 'open' : 'closed')}>{door === 'closed' ? 'Hap dyën (pamja e çiftuar)' : 'Mbyll dyën'}</button></> : <><div className={`virtual-robot ${gesture ? 'waving' : ''}`}>◉‿◉ <span>╱</span></div><p>Animacion prezantimi; nuk provon aftësi të robotit fizik.</p><button className="secondary" onClick={() => setGesture(!gesture)}>Përshëndetje virtuale</button></>}
  </section>;
}

const showcaseBrandLabel: Record<ShowcaseCard['brand'], string> = {
  portfolio: 'PORTFOLIO', github: 'GITHUB', youtube: 'YOUTUBE', instagram: 'INSTAGRAM', linkedin: 'LINKEDIN', facebook: 'FACEBOOK', spotify: 'SPOTIFY', piano: 'PIANO CORE', 'led-wall': 'LED WALL', 'hugo-eye': 'HUGO EYE', demo: 'DEMO',
};

function ShowcaseHub({ cards, onNavigate }: { cards: ShowcaseCard[]; onNavigate: (id: string) => void }) {
  const [activeDemo, setActiveDemo] = useState<Extract<ShowcaseCard['action'], { type: 'demo' }>['demo'] | null>(null);
  if (!cards.length) return null;
  return <section className="context-section workstation-hub" aria-label="Hub interaktiv">
    <div className="workstation-hub-head"><div><span>WORKSTATION</span><h3>Projektet & demonstrimet</h3></div><p>Karta të konfiguruara pa lidhje me runtime të jashtme.</p></div>
    <div className="showcase-grid">{cards.map(card => {
      const action = card.action;
      return <article className="showcase-card" key={card.id}>
        {card.mediaId ? <img src={mediaUrl(card.mediaId)} alt="" /> : <span className={`showcase-mark brand-${card.brand}`} aria-hidden="true">{showcaseBrandLabel[card.brand].slice(0, 2)}</span>}
        <div className="showcase-copy"><span>{showcaseBrandLabel[card.brand]}</span><strong>{card.title}</strong>{card.description && <p>{card.description}</p>}</div>
        {action.type === 'link' && <a className="secondary wide" href={action.url} target="_blank" rel="noopener noreferrer">{action.label} ↗</a>}
        {action.type === 'app' && <div className="showcase-actions"><a className="primary" href={action.url}>{action.label}</a><a className="secondary" href={action.fallbackUrl} target="_blank" rel="noopener noreferrer">Web ↗</a></div>}
        {action.type === 'demo' && <button className="secondary wide" aria-expanded={activeDemo === action.demo} onClick={() => setActiveDemo(activeDemo === action.demo ? null : action.demo)}>Shiko demonstrimin</button>}
        {action.type === 'portal' && <button className="secondary wide" onClick={() => onNavigate(action.sceneId)}>Hap pamjen →</button>}
      </article>;
    })}</div>
    {activeDemo && <VirtualDemo kind={activeDemo}/>}
  </section>;
}

export function DeviceControl({ object, devices, role, onCommand }: {
  object: HomeObject;
  devices: DeviceSnapshot | null;
  role: Role;
  onCommand: (id: string, on: boolean, brightness?: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const device = deviceForObject(object, devices);
  const enabled = canControlDevice(device, role);
  const hasPower = device?.capabilities?.includes('power') ?? false;
  const real = device?.source === 'home-assistant';
  const status = device?.state === 'on' ? 'Ndezur' : device?.state === 'off' ? 'Fikur' : device?.state === 'available' ? device.statusText ?? 'Aktive' : device ? 'Pa gjendje' : 'Pa lidhje';
  const labels:Record<string,string>={value:'Vlera',unit_of_measurement:'Njësia',current_temperature:'Temperatura aktuale',temperature:'Temperatura',humidity:'Lagështia',current_position:'Pozicioni',position:'Pozicioni',volume_level:'Volumi',hvac_action:'Gjendja e klimës',media_title:'Titulli',media_artist:'Artisti',battery_level:'Bateria',brightness:'Ndriçimi'};
  const values=Object.entries(device?.values??{}).filter(([,value])=>value!==null&&value!=='');
  return <section className={`device-box live-control context-section${device?.category==='tv'?' tv-panel':''}`}><div className="live-control-head"><div><span className={'device-state ' + (device?.state ?? 'unavailable')}><i />{status}</span><h3>{object.name}</h3><p>{real ? 'Home Assistant' : device?.source === 'smartthings' ? 'SmartThings' : device?.source === 'tuya' ? 'Smart Life/Tuya' : device?.source === 'mock' ? 'Demonstrim · MOCK' : 'Nuk ka pajisje të lidhur'}</p></div>{hasPower&&<button role="switch" aria-label={enabled ? `${object.name} · ${device?.state === 'on' ? 'Fike' : 'Ndize'}` : `${object.name} · kontrolli i padisponueshëm`} aria-checked={device?.state === 'on'} className={`switch ${device?.state === 'on' ? 'on' : ''}`} disabled={busy || !enabled} onClick={() => { setBusy(true); setError(''); void onCommand(object.id, device?.state !== 'on').catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}><span /></button>}</div>
    {device?.category==='tv'&&<p className="muted">Gjendje live në kohë reale. Telekomanda reale aktivizohet vetëm kur integrimi raporton aftësi komande dhe ju e autorizoni këtë pajisje saktësisht.</p>}
    {!device && <p className="muted">Nuk ka gjendje live ose komandë të lidhur me këtë objekt.</p>}
    {real && device?.state === 'unavailable' && <p className="muted">Home Assistant raporton unavailable. RediOnHome nuk simulon sukses.</p>}
    {real && !device?.controlEnabled && <p className="muted">Kjo lidhje është vetëm për lexim derisa të verifikohet identiteti i pajisjes.</p>}
    {(device?.source === 'smartthings' || device?.source === 'tuya') && <p className="muted">Ky provider jep vetëm lexim gjendjeje në këtë instalim.</p>}
    {values.length>0&&<dl className="device-values">{values.map(([key,value])=><div key={key}><dt>{labels[key]??key.replaceAll('_',' ')}</dt><dd>{String(value)}{key==='brightness'||key==='humidity'||key==='battery_level'?'%':''}</dd></div>)}</dl>}
    {enabled && device?.commandCapabilities?.includes('brightness') && <label className="brightness-control">Ndriçimi <strong>{device.brightness ?? 0}%</strong><input key={device.entityId} type="range" min="1" max="100" defaultValue={device.brightness ?? 100} disabled={busy} onPointerUp={e => { const value = Number(e.currentTarget.value); setBusy(true); setError(''); void onCommand(object.id, true, value).catch(err => setError(errorText(err))).finally(() => setBusy(false)); }} onKeyUp={e => { if (e.key === 'Enter') { const value = Number(e.currentTarget.value); setBusy(true); setError(''); void onCommand(object.id, true, value).catch(err => setError(errorText(err))).finally(() => setBusy(false)); } }} /></label>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    {device && <details className="device-technical"><summary>Detaje teknike</summary><p>Burimi: {device.source}{device.entityId ? ` · ${device.entityId}` : ''}</p><p>Gjendja e fundit: {device.observedAt ? new Date(device.observedAt).toLocaleString() : 'nuk raportohet'}</p></details>}
  </section>;
}

export function ProductDetail({ object, children, trail, devices, role, tour, onClose, onBack, onOpenChild, onCommand, onNavigate, onEdit, onAddChild, onConnectDevice }: {
  object: HomeObject;
  children: HomeObject[];
  trail: HomeObject[];
  devices: DeviceSnapshot | null;
  role: Role;
  tour: boolean;
  onClose: () => void;
  onBack?: () => void;
  onOpenChild: (id: string) => void;
  onEdit?: () => void;
  onAddChild?: () => void;
  onConnectDevice?: () => void;
  onCommand: (id: string, on: boolean, brightness?: number) => Promise<void>;
  onNavigate: (id: string) => void;
}) {
  const experience = resolveObjectExperience(object, tour ? 'showroom' : 'private');
  const visibleChildren = children.map(child => resolveObjectExperience(child, tour ? 'showroom' : 'private'));
  const ids = Array.from(new Set([experience.mediaId, ...(experience.gallery ?? [])].filter((id): id is string => !!id)));
  return <Dialog title={experience.name} eyebrow={`${tour ? 'VIRTUAL TOUR' : 'PRIVATE HOME'} · ${objectKindLabel[objectKind(object)]}`} onClose={onClose}>
    {trail.length > 1 && <div className="object-breadcrumbs" aria-label="Hierarkia e objektit">{trail.map((item, index) => <span key={item.id}>{index > 0 && <ChevronRight size={12} />} {resolveObjectExperience(item, tour ? 'showroom' : 'private').name}</span>)}</div>}
    {(onBack || onEdit || onAddChild || onConnectDevice) && <div className="object-compact-actions">
      {onBack && <button className="icon-button" aria-label="Prapa" title="Prapa" onClick={onBack}><ArrowLeft size={20} /></button>}
      {onEdit && <button className="icon-button" aria-label="Ndrysho objektin" title="Ndrysho objektin" onClick={onEdit}><Pencil size={20} /></button>}
      {onAddChild && <button className="icon-button" aria-label="Shto nivel" title="Shto nivel" onClick={onAddChild}><Plus size={20} /></button>}
      {onConnectDevice && <button className="icon-button" aria-label="Lidhje smart" title="Lidhje smart" onClick={onConnectDevice}><Link size={20} /></button>}
    </div>}
    <Gallery ids={ids} name={experience.name} children={visibleChildren} onOpenChild={onOpenChild} />
    {experience.description?.trim() && <p className="object-description">{experience.description}</p>}
    {!tour && !!object.experiences?.private?.journal?.length && <section className="context-section journal-section" aria-label="Journal privat">
      <h3>Journal privat</h3>
      <ul className="journal-list">{object.experiences.private.journal.map(entry => <li key={entry.id}><time>{new Date(entry.at).toLocaleString()}</time><p>{entry.text}</p></li>)}</ul>
      <p className="muted">Shënimet janë vetëm për pronarin dhe nuk eksportohen kurrë te Showroom.</p>
    </section>}
    <ShowcaseHub cards={experience.showcase ?? []} onNavigate={onNavigate}/>
    {!!visibleChildren.length && <section className="context-section"><h3>Brenda</h3><div className="child-list">{visibleChildren.map(child => <button key={child.id} onClick={() => onOpenChild(child.id)}><ObjectGlyph object={child}/><span><strong>{child.name}</strong><small>{objectKindLabel[objectKind(child)]}</small></span><ChevronRight size={16} /></button>)}</div></section>}
    {experience.actions.some(a => a.type === 'device') && !tour && <DeviceControl object={experience} devices={devices} role={role} onCommand={onCommand} />}
    {experience.videoId && <VideoPresentation id={experience.videoId} />}
    <TechnicalSpecifications items={object.specifications ?? []} />
    {object.documentation?.trim() && <section className="context-section"><h3>Dokumentacion</h3><p className="object-description">{object.documentation}</p></section>}
    {!!object.documents?.length && <section className="context-section"><h3>Dokumente & manuale</h3>{object.documents.map(d => <a key={d.id} className="secondary wide" href={mediaUrl(d.mediaId, d.mime === 'application/pdf' ? 'document.pdf' : 'document.txt')} download>{d.title} ↓</a>)}</section>}
    {experience.actions.map((a, i) => a.type === 'demo' ? <VirtualDemo key={i} kind={a.demo} /> : a.type === 'link' ? <a key={i} className="secondary wide" href={a.url} target="_blank" rel="noopener noreferrer">{a.label} ↗</a> : a.type === 'app' ? <div className="capture-actions" key={i}><a className="primary" href={a.url}>{a.label}</a><a className="secondary" href={a.fallbackUrl} target="_blank" rel="noopener noreferrer">Hap në web ↗</a></div> : a.type === 'portal' ? <button className="primary wide" key={i} onClick={() => onNavigate(a.sceneId)}>Hap pamjen →</button> : null)}
  </Dialog>;
}

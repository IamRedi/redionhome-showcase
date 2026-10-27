import { useEffect, useState } from 'react';
import type { Home } from '../shared/model.ts';
import { api, errorText, mediaUrl } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { ancestorIds, descendantIds, rootHasHotspot } from '../shared/hierarchy.ts';
import { mediaIdsForExperience, resolveObjectExperience } from '../shared/experience.ts';
type Version = {
    id: string;
    title: string;
    audience: 'invited' | 'public';
    approved: number;
    source_revision: number;
};
type Access = {
    user_id: string;
    role: string;
    label: string;
    expires: number;
    revoked: number;
    max_sessions: number;
};
export function Publishing({ home, onClose }: {
    home: Home;
    onClose: () => void;
}) {
    const [scenes, setScenes] = useState<string[]>([]), [objects, setObjects] = useState<string[]>([]), [media, setMedia] = useState<string[]>([]), [title, setTitle] = useState('Shtëpia · Virtual Tour'), [audience, setAudience] = useState<'invited' | 'public'>('invited'), [versions, setVersions] = useState<Version[]>([]), [active, setActive] = useState<Record<string, string | null>>({}), [access, setAccess] = useState<Access[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [invitation, setInvitation] = useState(''), [label, setLabel] = useState('Vizitor'), [hours, setHours] = useState(24), [sessions, setSessions] = useState(1), [role, setRole] = useState<'invited_guest' | 'household'>('invited_guest'), [commands, setCommands] = useState<string[]>([]);
    const load = async () => { const p = await api<{
        versions: Version[];
        exposure: {
            audience: string;
            publication_id: string | null;
        }[];
    }>('/publications'); setVersions(p.versions); setActive(Object.fromEntries(p.exposure.map(e => [e.audience, e.publication_id]))); setAccess(await api<Access[]>('/access')); };
    useEffect(() => { void load().catch(e => setError(errorText(e))); }, []);
    const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try {
        await fn();
        await load();
    }
    catch (e) {
        setError(errorText(e));
    }
    finally {
        setBusy(false);
    } };
    const toggle = (id: string, items: string[], set: (v: string[]) => void) => set(items.includes(id) ? items.filter(x => x !== id) : [...items, id]);
    const toggleObject=(id:string)=>{
        if(objects.includes(id)){const removed=new Set([id,...descendantIds(home.objects,id)]);setObjects(objects.filter(value=>!removed.has(value)));setCommands(commands.filter(value=>!removed.has(value)));return;}
        setObjects(Array.from(new Set([...objects,...ancestorIds(home.objects,id),id])));
    };
    const chosen = home.objects.filter(o => objects.includes(o.id));
    const mediaIds = Array.from(new Set([...home.scenes.filter(s => scenes.includes(s.id)).map(s => s.mediaId), ...chosen.flatMap(o => [...mediaIdsForExperience(o, 'showroom'),...(o.documents??[]).filter(d=>d.visibility==='public'||(audience==='invited'&&d.visibility==='invited')).map(d=>d.mediaId)])]));
    return <Dialog title="Përgatitni përvojën e vizitorit" eyebrow="TOUR · PËRZGJEDHJE & FTESA" onClose={onClose}>
 <div className="editor-form"><p className="muted">Zgjidhni përmbajtjen, krijoni një kopje të kufizuar dhe kontrolloni preview. Ndryshimet në shtëpinë private nuk publikohen automatikisht.</p>
 <label>Titulli i tour-it<input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}/></label>
 <label>Audienca<select value={audience} onChange={e => setAudience(e.target.value as typeof audience)}><option value="invited">Vetëm me ftesë</option><option value="public">Public Showcase · fillimisht i çaktivizuar</option></select></label>
 <fieldset><legend>1 · Skenat</legend>{home.scenes.map(s => <label className="check-row" key={s.id}><input type="checkbox" checked={scenes.includes(s.id)} onChange={() => toggle(s.id, scenes, setScenes)}/>{s.name}<small>{s.visibility ?? 'private'}</small></label>)}</fieldset>
 <fieldset><legend>2 · Objektet</legend>{home.objects.filter(o => rootHasHotspot(home,o.id,new Set(scenes))&&(o.visibility==='public'||(audience==='invited'&&o.visibility==='invited'))).map(o => {const showroom=resolveObjectExperience(o,'showroom');return <label className="check-row" key={o.id} style={{paddingLeft:`${ancestorIds(home.objects,o.id).length*14}px`}}><input type="checkbox" checked={objects.includes(o.id)} onChange={() => toggleObject(o.id)}/>{showroom.name}<small>{o.visibility ?? 'private'} · showroom</small></label>;})}</fieldset>
 <fieldset><legend>3 · Mediat e lejuara</legend>{mediaIds.map(id => {const doc=chosen.flatMap(o=>o.documents??[]).find(d=>d.mediaId===id);return <label className="check-row media-choice" key={id}><input type="checkbox" checked={media.includes(id)} onChange={() => toggle(id, media, setMedia)}/>{doc?<span aria-hidden="true">▤</span>:<img src={mediaUrl(id)} alt=""/>}<span>{doc?.title??home.scenes.find(s => s.mediaId === id)?.name ?? 'Media e objektit'}<small>{doc?.mime??id}</small></span></label>;})}</fieldset>
 <p className="notice">Panorama përmban gjithçka që shihet në fotografi. Fshehja e një hotspot-i nuk fsheh objektin në foto. Kontrolloni çdo pamje dhe video për përmbajtje personale para miratimit.</p>
 <button className="primary" disabled={busy || !scenes.length} onClick={() => void run(async () => { await api('/publications', 'POST', { title, audience, sceneIds: scenes, objectIds: objects, mediaIds: media, expectedRevision: home.revision }); })}>Krijo draft për preview</button>
 <section><h3>Versionet e tour-it</h3>{versions.length === 0 && <p className="muted">Nuk ka ende kopje të përgatitura.</p>}{versions.map(v => <article className="publication-card" key={v.id}><strong>{v.title}</strong><p>{v.audience} · Shtëpia v{v.source_revision} · {active[v.audience] === v.id ? 'AKTIV' : v.approved ? 'MIRATUAR' : 'DRAFT'}</p><div className="publication-actions"><a className="secondary" href={`/tour/${v.id}`} target="_blank" rel="noopener noreferrer">Preview si vizitor ↗</a><button className="secondary" disabled={busy || active[v.audience] === v.id} onClick={() => void run(async () => { await api(`/publications/${v.id}/activate`, 'POST', { approved: true }); })}>{v.approved ? 'Aktivizo këtë version' : 'Mirato për ' + (v.audience === 'public' ? 'Public Showcase' : 'ftesa')}</button></div></article>)}</section>
 {(['invited', 'public'] as const).map(a => active[a] && <button key={a} className="secondary" disabled={busy} onClick={() => void run(async () => { await api('/publications/disable', 'POST', { audience: a }); })}>Çaktivizo {a === 'public' ? 'Public Showcase' : 'tour-in me ftesë'}</button>)}
 <section><h3>Ftoni dikë</h3><label>Roli<select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="invited_guest">Invited Guest · vetëm tour</option><option value="household">Household · përzgjedhja private sipër</option></select></label><label>Emri i ftesës<input value={label} maxLength={100} onChange={e => setLabel(e.target.value)}/></label><div className="field-pair"><label>Skadon pas (orë)<input type="number" min={1} max={720} value={hours} onChange={e => setHours(Number(e.target.value))}/></label><label>Kufiri i sesioneve<input type="number" min={1} max={5} value={sessions} onChange={e => setSessions(Number(e.target.value))}/></label></div>
 {role === 'household' && <fieldset><legend>Lejo komandat MOCK</legend>{chosen.filter(o => o.permissions?.householdControl).map(o => <label className="check-row" key={o.id}><input type="checkbox" checked={commands.includes(o.id)} onChange={() => toggle(o.id, commands, setCommands)}/>{o.name}</label>)}<p className="muted">Objektet duhet të kenë lejet e familjes të aktivizuara në editor.</p></fieldset>}
 <button className="secondary" disabled={busy || (role === 'invited_guest' && !active.invited)} onClick={() => void run(async () => { const result = await api<{
        path: string;
    }>('/invitations', 'POST', { label, role, expiresHours: hours, maxSessions: sessions, grant: role === 'invited_guest' ? { publicationId: active.invited, sceneIds: [], objectIds: [], commandObjectIds: [] } : { sceneIds: scenes, objectIds: objects, commandObjectIds: commands } }); setInvitation(location.origin + result.path); })}>Krijo ftesë</button>
 {invitation && <label>Lidhja private e ftesës<input aria-label="Lidhja private e ftesës" readOnly value={invitation} onFocus={e => e.target.select()}/><span className="muted">Shfaqet vetëm tani. Ndajeni vetëm me personin e zgjedhur.</span></label>}
 {access.map(a => <div className="revision" key={a.user_id}><span>{a.label} · {a.role}<small>{a.revoked ? 'REVOKUAR' : new Date(a.expires).toLocaleString()} · {a.max_sessions} sesione</small></span><button disabled={busy || !!a.revoked} onClick={() => void run(async () => { await api(`/access/${a.user_id}/revoke`, 'POST'); })}>Revoko</button></div>)}</section>
 {error && <p className="inline-error" role="alert">{error}</p>}
 </div></Dialog>;
}

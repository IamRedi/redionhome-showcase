import { useState } from 'react';
import type { HomeObject, PrivateShowcaseCard, ShowcaseCard, VisitorAction } from '../shared/model.ts';
import { isVisitorAction } from '../shared/experience.ts';

type Experiences = NonNullable<HomeObject['experiences']>;
type PrivateProfile = NonNullable<Experiences['private']>;
type ShowroomProfile = NonNullable<Experiences['showroom']>;
type EditorCard = ShowcaseCard | PrivateShowcaseCard;
type ShowcaseEditorProfile = Omit<PrivateProfile | ShowroomProfile, 'showcase'> & { showcase?: EditorCard[] };

function replaceAction<T extends HomeObject['actions'][number]>(actions: T[], type: T['type'], next?: T): Array<T | {type:'info'}> {
  const result = [...actions.filter(action => action.type !== type), ...(next ? [next] : [])];
  return result.length ? result : [{type:'info'}];
}

function ProfileMedia({ profile, media, onChange }: {
  profile: PrivateProfile | ShowroomProfile;
  media: string[];
  onChange: (profile: PrivateProfile | ShowroomProfile) => void;
}) {
  return <>
    <label>Titulli i profilit<input maxLength={120} value={profile.title ?? ''} placeholder="Përdor emrin bazë" onChange={event => onChange({ ...profile, title: event.target.value || undefined })}/></label>
    <label>Përshkrimi i profilit<textarea maxLength={2000} rows={3} value={profile.description ?? ''} placeholder="Përdor përshkrimin bazë" onChange={event => onChange({ ...profile, description: event.target.value || undefined })}/></label>
    <label>Media kryesore<select value={profile.mediaId ?? ''} onChange={event => onChange({ ...profile, mediaId: event.target.value || undefined })}><option value="">Përdor median bazë</option>{media.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
  </>;
}

const brands: Array<[ShowcaseCard['brand'], string]> = [
  ['portfolio', 'Portfolio'], ['github', 'GitHub'], ['youtube', 'YouTube'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['facebook', 'Facebook'], ['spotify', 'Spotify'], ['piano', 'Piano Core'], ['led-wall', 'LED Wall'], ['hugo-eye', 'HUGO Eye'], ['demo', 'Demo'],
];

function ShowcaseFields({ profile, media, onChange }: {
  profile: ShowcaseEditorProfile;
  media: string[];
  onChange: (profile: ShowcaseEditorProfile) => void;
}) {
  const cards = profile.showcase ?? [];
  const updateCards = (next: EditorCard[]) => onChange({ ...profile, showcase: next.length ? next : undefined });
  const updateCard = (index: number, next: EditorCard) => updateCards(cards.map((card, current) => current === index ? next : card));
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= cards.length) return;
    const next = [...cards]; [next[index], next[destination]] = [next[destination], next[index]];
    updateCards(next);
  };
  const addCard = () => updateCards([...cards, {
    id: `showcase-${Date.now()}-${cards.length + 1}`,
    title: 'Kartë e re',
    brand: 'portfolio',
    action: { type: 'link', label: 'Hap lidhjen', url: 'https://example.com' },
  }]);
  return <section className="showcase-editor" aria-label="Karta interaktive">
    <div><strong>Hub me karta</strong><p className="muted">Renditja këtu përcakton renditjen në telefon. Kartat përdorin vetëm linke, fallback-e ose demo virtuale.</p></div>
    {cards.map((card, index) => {
      const action = card.action;
      const actionType = action.type === 'app' ? 'app' : action.type === 'demo' ? 'demo' : 'link';
      const changeType = (type: string) => updateCard(index, { ...card, action: type === 'app' ? { type: 'app', label: 'Hap në aplikacion', url: 'spotify:search:focus', fallbackUrl: 'https://open.spotify.com' } : type === 'demo' ? { type: 'demo', demo: 'piano' } : { type: 'link', label: 'Hap lidhjen', url: 'https://example.com' } });
      return <fieldset key={card.id} className="showcase-editor-card"><legend>Karta {index + 1}</legend>
        <div className="showcase-order"><button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑ Lart</button><button type="button" disabled={index === cards.length - 1} onClick={() => move(index, 1)}>↓ Poshtë</button><button type="button" onClick={() => updateCards(cards.filter((_, current) => current !== index))}>Hiq</button></div>
        <label>Lloji<select value={card.brand} onChange={event => updateCard(index, { ...card, brand: event.target.value as ShowcaseCard['brand'] })}>{brands.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Titulli<input maxLength={120} value={card.title} onChange={event => updateCard(index, { ...card, title: event.target.value })}/></label>
        <label>Përshkrimi<textarea rows={2} maxLength={280} value={card.description ?? ''} onChange={event => updateCard(index, { ...card, description: event.target.value || undefined })}/></label>
        <label>Media e kartës<select value={card.mediaId ?? ''} onChange={event => updateCard(index, { ...card, mediaId: event.target.value || undefined })}><option value="">Monogram / logo tekst</option>{media.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
        <label>Veprimi<select value={actionType} onChange={event => changeType(event.target.value)}><option value="link">Link HTTPS</option><option value="app">Android app + web fallback</option><option value="demo">Demo virtuale</option></select></label>
        {action.type === 'link' && <><label>Etiketa e linkut<input maxLength={120} value={action.label} onChange={event => updateCard(index, { ...card, action: { ...action, label: event.target.value } })}/></label><label>URL HTTPS<input type="url" maxLength={1000} value={action.url} onChange={event => updateCard(index, { ...card, action: { ...action, url: event.target.value } })}/></label></>}
        {action.type === 'app' && <><label>Etiketa e app-it<input maxLength={120} value={action.label} onChange={event => updateCard(index, { ...card, action: { ...action, label: event.target.value } })}/></label><label>Deep link<input maxLength={1000} value={action.url} onChange={event => updateCard(index, { ...card, action: { ...action, url: event.target.value } })}/></label><label>Fallback HTTPS<input type="url" maxLength={1000} value={action.fallbackUrl} onChange={event => updateCard(index, { ...card, action: { ...action, fallbackUrl: event.target.value } })}/></label></>}
        {action.type === 'demo' && <label>Demonstrimi<select value={action.demo} onChange={event => updateCard(index, { ...card, action: { type: 'demo', demo: event.target.value as 'piano' | 'led-wall' | 'robot' | 'fridge' } })}><option value="piano">Piano · LED virtual</option><option value="led-wall">LED Wall virtual</option><option value="robot">HUGO Eye · prezantim virtual</option><option value="fridge">Frigorifer · hap/mbyll i çiftuar</option></select></label>}
      </fieldset>;
    })}
    <button type="button" className="secondary" onClick={addCard}>+ Shto kartë</button>
  </section>;
}

export function ExperienceFields({ object, media, onChange }: {
  object: HomeObject;
  media: string[];
  onChange: (experiences: HomeObject['experiences']) => void;
}) {
  const experiences: Experiences = object.experiences ?? { version: 1 };
  const [noteDraft, setNoteDraft] = useState('');
  const privateProfile = experiences.private;
  const showroomProfile = experiences.showroom;
  const setPrivate = (profile?: PrivateProfile) => onChange({ ...experiences, version: 1, private: profile });
  const setShowroom = (profile?: ShowroomProfile) => onChange({ ...experiences, version: 1, showroom: profile });
  const privateActions = privateProfile?.actions ?? object.actions;
  const showroomActions = showroomProfile?.actions ?? object.actions.filter(isVisitorAction);
  const privateLink = privateActions.find(action => action.type === 'link');
  const showroomLink = showroomActions.find(action => action.type === 'link');
  const showroomApp = showroomActions.find(action => action.type === 'app');
  const enablePrivate = () => setPrivate({ version: 1, actions: privateActions });
  const enableShowroom = () => setShowroom({ version: 1, actions: showroomActions.length ? showroomActions : [{ type: 'info' }] });
  return <details><summary>Përvoja Private & Showroom</summary>
    <p className="muted">I njëjti objekt dhe histori, me përmbajtje e veprime të ndryshme sipas audiencës.</p>
    <fieldset><legend>Private Home</legend>
      <label className="check-row"><input type="checkbox" checked={!!privateProfile} onChange={event => event.target.checked ? enablePrivate() : setPrivate(undefined)}/>Përdor profil privat të veçantë</label>
      {privateProfile && <>
        <ProfileMedia profile={privateProfile} media={media} onChange={profile => setPrivate(profile as PrivateProfile)}/>
        <label>Lidhje private HTTPS<input type="url" maxLength={1000} placeholder="https://example.com/private" value={privateLink?.url ?? ''} onChange={event => setPrivate({ ...privateProfile, actions: replaceAction(privateActions, 'link', event.target.value ? { type: 'link', label: 'Hap lidhjen private', url: event.target.value } : undefined) })}/></label>
        <section className="journal-editor" aria-label="Journal privat">
          <strong>Journal privat</strong>
          <p className="muted">Shënimet e pronarit; publikimi i Showroom nuk i eksporton kurrë.</p>
          {(privateProfile.journal ?? []).map(entry => <div className="journal-entry" key={entry.id}>
            <time>{new Date(entry.at).toLocaleString()}</time><p>{entry.text}</p>
            <button type="button" aria-label="Hiq shënimin" onClick={() => setPrivate({ ...privateProfile, journal: privateProfile.journal!.filter(item => item.id !== entry.id) })}>Hiq</button>
          </div>)}
          <label>Shënim i ri<textarea maxLength={2000} rows={2} value={noteDraft} onChange={event => setNoteDraft(event.target.value)}/></label>
          <button type="button" className="secondary" disabled={!noteDraft.trim()} onClick={() => { setPrivate({ ...privateProfile, journal: [...(privateProfile.journal ?? []), { id: `note-${Date.now()}-${(privateProfile.journal?.length ?? 0) + 1}`, at: Date.now(), text: noteDraft.trim() }] }); setNoteDraft(''); }}>Shto shënim</button>
        </section>
        <ShowcaseFields profile={privateProfile} media={media} onChange={profile => setPrivate(profile as PrivateProfile)}/>
      </>}
    </fieldset>
    <fieldset><legend>Showroom</legend>
      <label className="check-row"><input type="checkbox" checked={!!showroomProfile} onChange={event => event.target.checked ? enableShowroom() : setShowroom(undefined)}/>Përdor profil Showroom të veçantë</label>
      {showroomProfile && <>
        <ProfileMedia profile={showroomProfile} media={media} onChange={profile => setShowroom(profile as ShowroomProfile)}/>
        <label>Lidhje publike HTTPS<input type="url" maxLength={1000} placeholder="https://example.com/product" value={showroomLink?.url ?? ''} onChange={event => setShowroom({ ...showroomProfile, actions: replaceAction(showroomActions, 'link', event.target.value ? { type: 'link', label: 'Faqja e produktit', url: event.target.value } : undefined) })}/></label>
        <label>Deep link i aplikacionit<input maxLength={1000} placeholder="spotify:album:…" value={showroomApp?.url ?? ''} onChange={event => setShowroom({ ...showroomProfile, actions: replaceAction(showroomActions, 'app', event.target.value || showroomApp?.fallbackUrl ? { type: 'app', label: 'Hap në aplikacion', url: event.target.value, fallbackUrl: showroomApp?.fallbackUrl ?? '' } : undefined) as VisitorAction[] })}/></label>
        <label>Fallback HTTPS<input type="url" maxLength={1000} placeholder="https://open.spotify.com/…" value={showroomApp?.fallbackUrl ?? ''} onChange={event => setShowroom({ ...showroomProfile, actions: replaceAction(showroomActions, 'app', event.target.value || showroomApp?.url ? { type: 'app', label: 'Hap në aplikacion', url: showroomApp?.url ?? '', fallbackUrl: event.target.value } : undefined) as VisitorAction[] })}/></label>
        <p className="muted">Deep link lejon vetëm skema të miratuara dhe kërkon gjithmonë një fallback publik HTTPS.</p>
        <ShowcaseFields profile={showroomProfile} media={media} onChange={profile => setShowroom(profile as ShowroomProfile)}/>
      </>}
    </fieldset>
  </details>;
}

import {useEffect,useState} from 'react';
import {api,errorText} from './api.ts';
export function PhoneAccess(){
 const [origin,setOrigin]=useState<string|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 useEffect(()=>{void api<{origin:string|null}>('/phone-access').then(r=>setOrigin(r.origin)).catch(e=>setError(errorText(e)));},[]);
 return <section className="notice phone-access"><h3>Hapeni nga telefoni</h3>{origin?<><p>Aktivizoni Tailscale në telefon dhe hyni në këtë lidhje private me llogarinë e shtëpisë.</p><a href={origin}>{origin}</a><button type="button" className="secondary" onClick={()=>void navigator.clipboard.writeText(origin).then(()=>setCopied(true)).catch(()=>setError('Zgjidhni dhe kopjoni lidhjen më sipër.'))}>{copied?'Lidhja u kopjua':'Kopjo lidhjen private'}</button></>:<p>Lidhja private është në përgatitje. Shtëpia mbetet e disponueshme në këtë kompjuter.</p>}<p className="muted">Panoramat importohen nga galeria ose files. Për foto të objekteve përdorni Fotografo nga afër. Instalimin në ekranin kryesor e ofron browser-i kur mbështetet.</p>{error&&<p role="alert">{error}</p>}</section>;
}

import {useEffect,useState} from 'react';
import type {Home,Role} from '../shared/model.ts';
import {AIAssistant} from './AIAssistant.tsx';
import {Brand,Login} from './Auth.tsx';
import {api,ApiError,errorText} from './api.ts';
import {rootObject} from '../shared/hierarchy.ts';

/** The phone entry imports no panorama, viewer, texture loader or device poller. */
export function AIPage(){
  const [role,setRole]=useState<Role|null>(null),[home,setHome]=useState<Home|null>(null),
    [boot,setBoot]=useState(true),[error,setError]=useState('');
  const load=async(nextRole?:Role)=>{
    try{
      const active=nextRole??(await api<{role:Role}>('/session')).role;
      setRole(active);
      if(active==='owner')setHome(await api<Home>('/home'));
    }catch(e){if(!(e instanceof ApiError&&e.code==='AUTH_REQUIRED'))setError(errorText(e));}
    finally{setBoot(false);}
  };
  useEffect(()=>{void load();},[]);
  if(boot)return <main className="boot"><Brand/><span className="loader-ring"/></main>;
  if(!role)return <Login onLogin={next=>void load(next)}/>;
  return <main className="ai-page"><Brand/><a className="secondary" href="/">Hap shtëpinë</a>
    {error&&<p role="alert">{error}</p>}
    {role!=='owner'&&<p>Asistenti është i disponueshëm për pronarin e shtëpisë.</p>}
    {role==='owner'&&!home&&<button className="secondary" onClick={()=>void load()}>Riprovo</button>}
    {home&&<AIAssistant home={home} context={home.name} onClose={()=>location.assign('/')}
      onNavigate={id=>location.assign(`/?scene=${encodeURIComponent(id)}`)}
      onOpenObject={id=>{
        const root=rootObject(home.objects,id);
        const scene=home.scenes.find(s=>s.hotspots.some(h=>h.objectId===root?.id));
        location.assign(`/?object=${encodeURIComponent(id)}${scene?`&scene=${encodeURIComponent(scene.id)}`:''}`);
      }} onDevices={()=>undefined}/>}
  </main>;
}

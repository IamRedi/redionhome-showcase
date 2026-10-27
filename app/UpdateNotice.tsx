import {useEffect,useRef,useState} from 'react';
import {Button} from './Button.tsx';
declare const __BUILD_ID__:string;
export const clientBuild=__BUILD_ID__;

export function UpdateNotice() {
  const [server,setServer]=useState(clientBuild),[worker,setWorker]=useState('—');
  const [details,setDetails]=useState(false),[message,setMessage]=useState('');
  const [waiting,setWaiting]=useState(false);
  const [updating,setUpdating]=useState(false);
  const registration=useRef<ServiceWorkerRegistration|null>(null);
  const reloadRequested=useRef(false);
  useEffect(()=>{
    let disposed=false;
    const workerVersion=()=>{
      const controller=navigator.serviceWorker?.controller;
      if(!controller)return;
      const channel=new MessageChannel();
      const timeout=setTimeout(()=>channel.port1.close(),2000);
      channel.port1.onmessage=e=>{clearTimeout(timeout);channel.port1.close();if(!disposed)setWorker(String(e.data.buildId));};
      controller.postMessage({type:'VERSION'},[channel.port2]);
    };
    const check=async()=>{
      try{
        const response=await fetch('/build.json',{cache:'no-store'});
        if(response.ok){const data=await response.json();if(!disposed&&typeof data.buildId==='string')setServer(data.buildId);}
        await registration.current?.update();
        if(!disposed)setWaiting(!!registration.current?.waiting);
        workerVersion();
      }catch{/* Offline: keep this tab; never enqueue commands. */}
    };
    const changed=()=>{
      if(!disposed){setWaiting(false);setUpdating(false);}
      workerVersion();
      // Only the tab whose user requested an update may reload.
      if(reloadRequested.current){
        reloadRequested.current=false;
        if(!document.querySelector('dialog,[role="dialog"]'))location.reload();
        else setMessage('Versioni është gati. Mbyllni panelin përpara rifreskimit.');
      }
      else void check();
    };
    if(import.meta.env.PROD&&'serviceWorker' in navigator){
      navigator.serviceWorker.addEventListener('controllerchange',changed);
      void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(reg=>{
        if(disposed)return;
        registration.current=reg;
        reg.addEventListener('updatefound',()=>{
          const installing=reg.installing;
          installing?.addEventListener('statechange',()=>{
            if(!disposed&&installing.state==='installed')setWaiting(!!reg.waiting);
          });
        });
        void check();
      }).catch(()=>void check());
    }else void check();
    window.addEventListener('focus',check);
    window.addEventListener('online',check);
    const interval=setInterval(check,60000);
    return()=>{disposed=true;clearInterval(interval);window.removeEventListener('focus',check);window.removeEventListener('online',check);navigator.serviceWorker?.removeEventListener('controllerchange',changed);};
  },[]);
  const update=async()=>{
    if(updating)return;
    if(document.querySelector('dialog,[role="dialog"]')){
      setMessage('Mbyllni panelin e hapur; drafti i editorit ruhet në këtë sesion. Pastaj përditësoni.');
      return;
    }
    setUpdating(true);
    try{
      const response=await fetch('/build.json',{cache:'no-store'});
      if(!response.ok)throw Error();
      await response.json();
      const reg=registration.current;
      await reg?.update();
      if(document.querySelector('dialog,[role="dialog"]')){setUpdating(false);return;}
      if(reg?.waiting){
        reloadRequested.current=true;
        reg.waiting.postMessage({type:'ACTIVATE'});
      }else location.reload();
    }catch{setUpdating(false);setMessage('Pa lidhje. Përditësimi nuk u krye; puna juaj mbetet këtu.');}
  };
  return <aside className="release-status" aria-label="Versioni i aplikacionit" data-client-build={clientBuild}>
    {(server!==clientBuild||waiting)&&<div className="release-update" role="status"><span>{server!==clientBuild?'Version i ri gati':'Përditësimi gati për aktivizim'}</span><Button disabled={updating} onClick={()=>void update()}>{updating?'Duke përditësuar…':'Përditëso'}</Button></div>}
    <button className="release-version" onClick={()=>setDetails(!details)} aria-expanded={details}>Versioni {clientBuild.slice(0,7)}</button>
    {details&&<div className="release-details">Klienti: {clientBuild}<br/>Serveri: {server}<br/>Worker: {worker}</div>}
    {message&&<p role="status">{message}</p>}
  </aside>;
}

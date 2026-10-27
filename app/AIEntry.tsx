import {createContext,useContext} from 'react';
import {Button} from './Button.tsx';

export const AIEntryContext=createContext<{open:()=>void;active:boolean}|null>(null);
export function AIEntry({className=''}:{className?:string}){
  const ai=useContext(AIEntryContext);
  if(!ai||ai.active)return null;
  return <Button className={`ai-entry ${className}`} aria-label="R AI" title="R AI · Asistenti i shtëpisë" onClick={ai.open}>R AI</Button>;
}

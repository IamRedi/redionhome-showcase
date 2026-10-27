import { readFileSync } from 'node:fs';
import path from 'node:path';
// Explicit trusted private origin only. Never trust Forwarded/Host suffixes or
// accept arbitrary domains; keeping this local file absent leaves loopback-only.
export function phoneOrigin(root:string):URL|undefined{
 try{
  const data=JSON.parse(readFileSync(path.join(root,'phone-access.json'),'utf8'));
  const origin=new URL(data.origin);
  if(origin.protocol!=='https:'||origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(origin.hostname))return;
  return origin;
 }catch{return;}
}

import {spawn} from 'node:child_process';
import process from 'node:process';
import {setTimeout} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {log} from 'node:console';
const {fetch}=globalThis;
const port=8789,origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['scripts/serve-showcase.mjs','--port',String(port),...(process.argv.includes('--container')?['--container']:[])],{stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
try {
 let ready=false;
 for(let attempt=0;attempt<90;attempt++) {
  if(child.exitCode!==null)throw Error(output);
  try{if((await fetch(origin+'/api/v1/health')).ok){ready=true;break;}}catch{/* Not listening yet. */}
  await setTimeout(500);
 }
 assert(ready,'Demo did not start');
 assert.equal((await fetch(origin+'/api/v1/home')).status,401);
 const login=await fetch(origin+'/api/v1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'showcase-local-demo-only'})});
 assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
 const home=await (await fetch(origin+'/api/v1/home',{headers})).json();
 assert.equal(home.id,'demo-home');
 const ai=await (await fetch(origin+'/api/v1/ai/status',{headers})).json();
 assert.equal(ai.provider,'scripted-showcase');
 assert.equal((await fetch(origin+'/api/v1/integrations/home-assistant',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await fetch(origin+'/ai')).status,200);
 log(JSON.stringify({offline_smoke:'passed',data:'CC0 and synthetic',ai:'scripted, no model',providers:'blocked'}));
}finally{child.kill('SIGTERM');}

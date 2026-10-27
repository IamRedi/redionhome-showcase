// Local TLS/authentication verification through this computer's userspace tailnet.
// No phone interaction, home mutation, private photograph or credential output.
import net from 'node:net';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {URL} from 'node:url';
import {log} from 'node:console';
const root=path.resolve(process.env.DATA_DIR??'.data');
const {origin}=JSON.parse(readFileSync(path.join(root,'phone-access.json'),'utf8'));
const dns=new URL(origin).hostname,children=new Set();
const bridge=net.createServer(socket=>{
 const child=spawn(path.join(root,'tools/tailscale_1.104.1_amd64/tailscale'),[`--socket=${path.join(root,'tailscale/daemon.sock')}`,'nc',dns,'443']);children.add(child);
 child.stdin.on('error',()=>socket.destroy());child.stdout.on('error',()=>socket.destroy());socket.on('error',()=>child.kill());child.on('error',()=>socket.destroy());
 socket.pipe(child.stdin);child.stdout.pipe(socket);child.stderr.resume();socket.on('close',()=>child.kill());child.on('close',()=>{children.delete(child);socket.destroy();});
});
await new Promise((resolve,reject)=>{bridge.once('error',reject);bridge.listen(0,'127.0.0.1',resolve);});
function call(route,method='GET',body,headers={}){
 return new Promise((resolve,reject)=>{
  const req=https.request({hostname:dns,port:bridge.address().port,servername:dns,path:route,method,agent:false,lookup:(_h,_o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),headers:{Host:dns,...headers,...(body?{'Content-Type':'application/json'}:{})}},res=>{
   let content='';res.on('data',b=>{content+=b;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,content,verified:res.socket?.authorized}));
  });req.setTimeout(30000,()=>req.destroy(Error('PRIVATE_TLS_TIMEOUT')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
try{
 const health=await call('/api/v1/health');if(health.status!==200)throw Error(`Health ${health.status}`);
 const anonymous=await call('/api/v1/home');if(anonymous.status!==401)throw Error('Anonymous boundary failed');
 const password=readFileSync(path.join(root,'owner-password.txt'),'utf8').trim();
 const login=await call('/api/v1/login','POST',{password},{Origin:origin});if(login.status!==200)throw Error('Private HTTPS login failed');
 const fullCookie=login.headers['set-cookie'][0];if(!fullCookie.includes('Secure')||!fullCookie.includes('HttpOnly'))throw Error('Secure cookie missing');
 const cookie=fullCookie.split(';')[0],home=await call('/api/v1/home','GET',undefined,{Cookie:cookie});if(home.status!==200)throw Error('Private home retrieval failed');
 const ai=await call('/api/v1/photo-assistant','GET',undefined,{Cookie:cookie});
 const csrf=await call('/api/v1/login','POST',{password},{Origin:'http://127.0.0.1:4173'});if(csrf.status!==403)throw Error('Cross-origin boundary failed');
 const report={origin,tlsCertificateVerified:true,httpsHealth:'PASS',anonymousDenied:'PASS',ownerLogin:'PASS',secureHttpOnlyCookie:'PASS',crossOriginDenied:'PASS',homeRevision:JSON.parse(home.content).revision,sceneNames:JSON.parse(home.content).scenes.map(s=>s.name),liveAIEnabled:JSON.parse(ai.content).enabled,physicalPhone:'NOT_VERIFIED',publicFunnel:false};
 writeFileSync('docs/m3/private-https.json',JSON.stringify(report,null,2)+'\n');log(JSON.stringify(report));
}finally{for(const child of children)child.kill();bridge.close();}

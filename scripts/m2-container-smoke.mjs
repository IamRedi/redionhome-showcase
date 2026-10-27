import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {log} from 'node:console';
const suffix=randomUUID().slice(0,8),name=`redionhome-m2-qa-${suffix}`,volume=`redionhome-m2-qa-${suffix}`;
let containerCreated=false,volumeCreated=false,report;
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:2_000_000});
try{
 docker(['volume','create',volume]);volumeCreated=true;
 docker(['run','-d','--name',name,'--network','none','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=128m','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=volume,src=${volume},dst=/data`,'-e','OWNER_PASSWORD=synthetic-container-password-42','redionhome:m2']);containerCreated=true;
 const script=String.raw`
 import {readFileSync,existsSync,writeFileSync} from 'node:fs';
 import {execFileSync} from 'node:child_process';
 const origin='http://127.0.0.1:4173';
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/v1/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 const login=await fetch(origin+'/api/v1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-container-password-42'})});
 if(!login.ok)throw Error('Login failed');
 const cookie=login.headers.get('set-cookie').split(';')[0];
 async function call(route,method='GET',body,session=cookie){const headers={Origin:origin,Cookie:session};if(body&&!Buffer.isBuffer(body))headers['Content-Type']='application/json';if(Buffer.isBuffer(body))headers['Content-Type']='application/octet-stream';const r=await fetch(origin+'/api/v1'+route,{method,headers,body:body?(Buffer.isBuffer(body)?body:JSON.stringify(body)):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():undefined};}
 const photo=await call('/uploads?kind=photo','POST',readFileSync('/app/assets/demo/studio.jpg'));if(photo.status!==201)throw Error('Photo upload failed');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=green:s=64x64:d=0.5','-c:v','libx264','-pix_fmt','yuv420p','/tmp/synthetic.mp4']);
 const video=await call('/uploads?kind=video','POST',readFileSync('/tmp/synthetic.mp4'));if(video.status!==201)throw Error('Video upload failed');
 const home=(await call('/home')).data;home.scenes[0].visibility='invited';home.objects[0].visibility='invited';home.objects[0].gallery=[photo.data.id];home.objects[0].videoId=video.data.id;
 const saved=await call('/home','PUT',home);if(saved.status!==200)throw Error('Config save failed');
 const draft=await call('/publications','POST',{title:'Container tour',audience:'invited',sceneIds:['atelier-view'],objectIds:['artwork'],mediaIds:['atelier',photo.data.id,video.data.id],expectedRevision:saved.data.revision});if(draft.status!==201)throw Error('Publication failed');
 await call('/publications/'+draft.data.id+'/activate','POST',{approved:true});
 const invitation=await call('/invitations','POST',{label:'Synthetic visitor',role:'invited_guest',expiresHours:1,maxSessions:1,grant:{publicationId:draft.data.id}});if(invitation.status!==201)throw Error('Invitation failed');
 const redeemed=await fetch(origin+'/api/v1/invitations/redeem',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:invitation.data.token})});if(!redeemed.ok)throw Error('Redeem failed');
 const guest=redeemed.headers.get('set-cookie').split(';')[0];
 if((await call('/tours/'+draft.data.id+'/home','GET',undefined,guest)).status!==200)throw Error('Guest tour failed');
 for(const route of ['/home','/devices','/media/atelier/preview.jpg'])if((await call(route,'GET',undefined,guest)).status!==403)throw Error('Private boundary failed');
 if((await call('/commands','POST',{objectId:'light',action:'turn_on'},guest)).status!==403)throw Error('Command boundary failed');
 await call('/access/'+invitation.data.id+'/revoke','POST',{});
 if((await call('/tours/'+draft.data.id+'/home','GET',undefined,guest)).status!==403)throw Error('Revocation failed');
 if(existsSync('/app/assets/Kitch_1.jpg')||existsSync('/app/assets/Living_ok.jpg'))throw Error('Private input leaked into image');
 writeFileSync('/data/synthetic-qa.json',JSON.stringify({publicationId:draft.data.id}),{mode:0o600});
 console.log(JSON.stringify({photoImport:'PASS',videoImport:'PASS',invitedTour:'PASS',privateMediaBoundary:'PASS',commandBoundary:'PASS',revocation:'PASS',privateOriginalsAbsent:true,uid:process.getuid()}));
 `;
 const result=JSON.parse(docker(['exec',name,'node','--input-type=module','-e',script]));
 docker(['restart',name]);
 const persistence=String.raw`
 import {readFileSync} from 'node:fs';
 const id=JSON.parse(readFileSync('/data/synthetic-qa.json','utf8')).publicationId;
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4173/api/v1/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 const login=await fetch('http://127.0.0.1:4173/api/v1/login',{method:'POST',headers:{Origin:'http://127.0.0.1:4173','Content-Type':'application/json'},body:JSON.stringify({password:'synthetic-container-password-42'})});
 const cookie=login.headers.get('set-cookie').split(';')[0];const r=await fetch('http://127.0.0.1:4173/api/v1/publications',{headers:{Cookie:cookie}});const data=await r.json();if(!data.versions.some(v=>v.id===id&&v.approved===1))throw Error('Publication persistence failed');console.log(JSON.stringify({publicationRestart:'PASS'}));
 `;
 const persisted=JSON.parse(docker(['exec',name,'node','--input-type=module','-e',persistence]));
 const image=JSON.parse(docker(['image','inspect','redionhome:m2']))[0].Id;
 report={...result,...persisted,image,network:'none',readOnlyRoot:true,disposableResourcesRemoved:true};
}finally{
 if(containerCreated)docker(['rm','-f',name]);
 if(volumeCreated)docker(['volume','rm',volume]);
}
writeFileSync('docs/m2/container-smoke.json',JSON.stringify(report,null,2));log(JSON.stringify(report));

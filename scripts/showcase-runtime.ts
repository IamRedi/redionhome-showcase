import {startServer} from '../server/index.ts';
import type {AIProvider} from '../server/ai.ts';

// Deliberately scripted, not a language model. Only the existing MOCK light is proposed.
const provider:AIProvider={id:'scripted-showcase',label:'DEMO e skriptuar · pa model AI',destination:'Vetëm procesi lokal',model:'no-model',
  async respond({message,context}) {
    const light=context.home.objects.find(object=>object.id==='light');
    const navigate=/studio|atelie|workshop/i.test(message)&&!/drit|light|lamp/i.test(message);
    const target=navigate?context.home.scenes.find(scene=>scene.id==='studio-view'):undefined;
    const command=!navigate&&light&&/drit|light|lamp|film/i.test(message);
    return {reply:command?'DEMO e skriptuar: po propozoj ndezjen e dritës virtuale. Lejet dhe konfirmimi kontrollohen nga aplikacioni; asnjë pajisje reale nuk lidhet.':navigate?'DEMO e skriptuar: hapja e studios përdor navigimin real të aplikacionit.':'Ky është një shembull i paracaktuar offline. Provoni “Ndiz dritën” ose “Hap studion”. Nuk përdoret model AI.',
      navigation:target?{type:'scene',targetId:target.id}:{type:'none',targetId:null},
      commands:command?[{objectId:light.id,action:'turn_on',brightness:null,reason:'Vetëm drita virtuale MOCK'}]:[],
      inventory:[],limitations:['Përgjigje e skriptuar; jo AI live. Pa mikrofon, internet ose pajisje reale.'],
      targetResolution:command?'exact':'none',ambient:null};
  }};
await startServer(undefined,{aiProvider:provider,clientDirectory:'showcase-dist'});
console.log('Showcase ready. Local demo login: owner / showcase-local-demo-only');

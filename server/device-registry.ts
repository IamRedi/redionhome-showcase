import {randomUUID} from 'node:crypto';
import type {Store} from './store.ts';
import type {Home} from '../shared/model.ts';

export class DeviceRegistry {
  constructor(private store:Store){}
  list(){
    return this.store.db.prepare(`SELECT c.id AS deviceId,c.object_id AS objectId,c.primary_provider AS primaryProvider,
      p.provider,p.external_id AS externalId,p.confirmed_by AS confirmedBy
      FROM canonical_devices c JOIN provider_identities p ON p.device_id=c.id ORDER BY c.object_id,p.provider`).all();
  }
  providerBindings(provider:'smartthings'|'tuya'){
    return this.store.db.prepare(`SELECT c.id AS deviceId,c.object_id AS objectId,c.primary_provider AS primaryProvider,
      p.external_id AS externalId FROM canonical_devices c JOIN provider_identities p ON p.device_id=c.id
      WHERE p.provider=?`).all(provider) as {deviceId:string;objectId:string;primaryProvider:string;externalId:string}[];
  }
  smartthingsBindings(){return this.providerBindings('smartthings');}
  tuyaBindings(){return this.providerBindings('tuya');}
  linkSmartThings(home:Home,objectId:string,externalId:string){return this.linkProvider(home,objectId,externalId,'smartthings');}
  linkTuya(home:Home,objectId:string,externalId:string){return this.linkProvider(home,objectId,externalId,'tuya');}
  private linkProvider(home:Home,objectId:string,externalId:string,provider:'smartthings'|'tuya'){
    const object=home.objects.find(o=>o.id===objectId);
    if(!object||!home.scenes.some(s=>s.hotspots.some(h=>h.objectId===objectId)))throw Error('DEVICE_OBJECT_NEEDS_HOTSPOT');
    const existing=this.store.db.prepare('SELECT device_id FROM provider_identities WHERE provider=? AND external_id=?').get(provider,externalId);
    if(existing)throw Error('DEVICE_IDENTITY_CONFLICT');
    let canonical=this.store.db.prepare('SELECT id,primary_provider FROM canonical_devices WHERE object_id=?').get(objectId) as {id:string;primary_provider:string}|undefined;
    if(canonical&&canonical.primary_provider!=='home-assistant')throw Error('DEVICE_OBJECT_ALREADY_BOUND');
    if(!canonical&&object.actions.some(a=>a.type==='device')&&object.provider?.active&&object.provider.active!=='mock')throw Error('DEVICE_OBJECT_ALREADY_BOUND');
    return this.store.db.transaction(()=>{
      if(!canonical){
        canonical={id:`device-${randomUUID()}`,primary_provider:provider};
        this.store.db.prepare('INSERT INTO canonical_devices(id,object_id,primary_provider) VALUES(?,?,?)').run(canonical.id,objectId,provider);
      }
      this.store.db.prepare('INSERT INTO provider_identities(provider,external_id,device_id,confirmed_by) VALUES(?,?,?,?)').run(provider,externalId,canonical.id,'owner');
      const next=canonical.primary_provider===provider?this.store.save({...home,objects:home.objects.map(o=>o.id===objectId?{...o,provider:{identity:o.id,active:provider,status:'configured' as const},actions:[...o.actions.filter(a=>a.type!=='device'&&(a.type!=='integration'||a.adapterId!==provider)),{type:'device' as const,bindingId:canonical!.id}]}:o)},'owner'):home;
      this.store.audit('owner','device.identity.linked',`${provider}:${canonical.id}`);
      return next;
    })();
  }
  unlinkSmartThings(home:Home,objectId:string){return this.unlinkProvider(home,objectId,'smartthings');}
  unlinkTuya(home:Home,objectId:string){return this.unlinkProvider(home,objectId,'tuya');}
  private unlinkProvider(home:Home,objectId:string,provider:'smartthings'|'tuya'){
    const binding=this.providerBindings(provider).find(b=>b.objectId===objectId);
    if(!binding)throw Error('UNKNOWN_BINDING');
    return this.store.db.transaction(()=>{
      this.store.db.prepare('DELETE FROM provider_identities WHERE provider=? AND device_id=?').run(provider,binding.deviceId);
      let next=home;
      if(binding.primaryProvider===provider){
        this.store.db.prepare('DELETE FROM canonical_devices WHERE id=?').run(binding.deviceId);
        next=this.store.save({...home,objects:home.objects.map(o=>{
          if(o.id!==objectId)return o;
          const actions=o.actions.filter(a=>!(a.type==='device'&&a.bindingId===binding.deviceId));
          return {...o,provider:undefined,actions:actions.length?actions:[{type:'info' as const}]};
        })},'owner');
      }
      this.store.audit('owner','device.identity.unlinked',`${provider}:${binding.deviceId}`);
      return next;
    })();
  }
}

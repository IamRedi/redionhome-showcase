import type {HomeAction} from '../shared/actions.ts';
import type {DeviceSnapshot,Home} from '../shared/model.ts';
import type {Identity} from './tours.ts';
import type {Store} from './store.ts';
import type {HomeAssistantPilot} from './home-assistant.ts';
import type {DeviceAdapter} from './adapters.ts';

export class ActionError extends Error{
  constructor(readonly status:number,code:string){super(code);}
}

/** The single dispatch boundary for existing buttons, AI and saved ambients. */
export function commandDispatcher(store:Store,ha:HomeAssistantPilot,adapter:DeviceAdapter,permittedHome:(actor:Identity)=>Home){
  return async(actor:Identity,input:HomeAction,accepted:()=>void):Promise<DeviceSnapshot>=>{
    const deny=(status:number,code:string):never=>{store.audit(actor.id,'command.denied',code);throw new ActionError(status,code);};
    if(actor.role!=='owner'&&actor.role!=='household')deny(403,'OWNER_REQUIRED');
    const object=store.home().objects.find(o=>o.id===input.objectId),binding=object?.actions.find(a=>a.type==='device');
    if(!object||!binding||binding.type!=='device')return deny(403,'UNKNOWN_BINDING');
    if(actor.role==='household'&&(!actor.grant?.commandObjectIds.includes(object.id)||object.permissions?.householdControl!==true||!permittedHome(actor).objects.some(o=>o.id===object.id)))deny(403,'COMMAND_NOT_ALLOWED');
    const real=ha.binding(object.id);
    if(real){
      if(binding.bindingId!==real.binding_id||object.provider?.active!=='home-assistant')deny(403,'UNKNOWN_BINDING');
      if(actor.role!=='owner')deny(403,'COMMAND_NOT_ALLOWED');
      if(!/^(?:light|switch)\./.test(real.entity_id))deny(403,'HA_COMMAND_ENTITY_UNSUPPORTED');
      if(real.control_enabled!==1||object.actions.some(a=>a.type==='portal'))deny(403,'HA_CONTROL_NOT_ENABLED');
      if(input.confirmEntityId!==real.entity_id)deny(400,'HA_CONFIRM_ENTITY');
      if(input.action==='set_brightness'&&(!real.entity_id.startsWith('light.')||input.brightness===undefined))deny(400,'HA_BRIGHTNESS_REQUIRED');
      try{await ha.command(real.entity_id,input.action,input.brightness,accepted);store.audit(actor.id,'ha.command.confirmed',`${object.id}:${real.entity_id}:${input.action}`);}
      catch(e){store.audit(actor.id,'ha.command.failed',`${object.id}:${real.entity_id}:${input.action}:${e instanceof Error?e.message:'HA_ERROR'}`);throw e;}
      const mock=await adapter.snapshot();return {...mock,entities:[...mock.entities,...ha.snapshot()]};
    }
    if(object.provider&&object.provider.active!=='mock')deny(403,'REAL_COMMANDS_PHASE_2_LOCKED');
    if(input.action==='set_brightness')return deny(403,'UNSUPPORTED_CAPABILITY');
    const snapshot=await adapter.snapshot();
    if(snapshot.mode!=='mock')deny(403,'REAL_COMMANDS_PHASE_2_LOCKED');
    if(snapshot.connection!=='online'||!snapshot.entities.some(e=>e.bindingId===binding.bindingId&&e.state!=='unavailable'))deny(409,'DEVICE_UNAVAILABLE');
    await adapter.command(binding.bindingId,input.action);accepted();
    store.audit(actor.id,'mock.command',`${binding.bindingId}:${input.action}`);
    return adapter.snapshot();
  };
}

import {z} from 'zod';
import {idSchema, type HomeObject} from '../shared/model.ts';
import {withoutDevice} from '../shared/editor.ts';
import type {Store} from './store.ts';

export const bindingEditSchema = z.object({objectId:idSchema, expectedRevision:z.number().int().positive(),
  confirm:z.literal(true), operation:z.enum(['detach','move']), targetObjectId:idSchema.optional()}).strict();

// A single transaction moves the identity and object actions together. No provider call.
export function editBinding(store: Store, input: z.infer<typeof bindingEditSchema>, actor: string) {
  return store.db.transaction(() => {
    const home = store.home();
    if (home.revision !== input.expectedRevision) throw Error('REVISION_CONFLICT');
    const source = home.objects.find(object => object.id === input.objectId);
    const canonical = store.db.prepare('SELECT id FROM canonical_devices WHERE object_id=?').get(input.objectId) as {id:string}|undefined;
    const ha = store.db.prepare('SELECT binding_id FROM ha_bindings WHERE object_id=?').get(input.objectId) as {binding_id:string}|undefined;
    if (!source || (!canonical && !ha)) throw Error('UNKNOWN_BINDING');
    let target: HomeObject | undefined;
    if (input.operation === 'move') {
      target = home.objects.find(object => object.id === input.targetObjectId);
      if (!target || target.id === source.id || target.parentId || target.actions.some(action => action.type === 'device') ||
          target.provider?.status === 'configured' || !home.scenes.some(scene => scene.hotspots.some(hotspot => hotspot.objectId === target!.id)) ||
          store.db.prepare('SELECT 1 FROM canonical_devices WHERE object_id=?').get(target.id) ||
          store.db.prepare('SELECT 1 FROM ha_bindings WHERE object_id=?').get(target.id)) throw Error('DEVICE_OBJECT_ALREADY_BOUND');
      if (ha) store.db.prepare('UPDATE ha_bindings SET object_id=? WHERE object_id=?').run(target.id, source.id);
      if (canonical) store.db.prepare('UPDATE canonical_devices SET object_id=? WHERE id=?').run(target.id, canonical.id);
    } else {
      store.db.prepare('DELETE FROM ha_bindings WHERE object_id=?').run(source.id);
      if (canonical) store.db.prepare('DELETE FROM canonical_devices WHERE id=?').run(canonical.id);
    }
    const attach = (object:HomeObject):HomeObject => {
      const clean = withoutDevice(object), devices = source.actions.filter(action => action.type === 'device');
      return {...clean, provider: source.provider ? {...source.provider, identity:object.id} : undefined,
        actions:[...devices,...clean.actions], experiences: clean.experiences?.private?.actions ? {...clean.experiences, private: {...clean.experiences.private, actions:[...devices,...clean.experiences.private.actions]}} : clean.experiences};
    };
    const next = store.save({...home, objects:home.objects.map(object => object.id === source.id ? withoutDevice(object) : object.id === target?.id ? attach(object) : object)}, actor);
    store.audit(actor, `device.binding.${input.operation}`, `${source.id}:${target?.id ?? ''}`);
    return next;
  })();
}

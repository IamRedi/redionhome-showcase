import type {HomeObject} from './model.ts';

export function managedDevice(object?: Partial<HomeObject>) {
  return !!object?.actions?.some(action => action.type === 'device') &&
    ['home-assistant', 'smartthings', 'tuya'].includes(object?.provider?.active ?? '');
}

// Presentation edits cannot replace a real device identity with the demo binding.
export function preserveDevice(original: HomeObject | undefined, edited: HomeObject): HomeObject {
  if (!managedDevice(original)) return edited;
  const devices = original!.actions.filter(action => action.type === 'device');
  const profile = edited.experiences?.private;
  return {...edited, provider: original!.provider,
    actions: [...devices, ...edited.actions.filter(action => action.type !== 'device')],
    experiences: profile?.actions ? {...edited.experiences!, private: {...profile,
      actions: [...devices, ...profile.actions.filter(action => action.type !== 'device')]}} : edited.experiences};
}

export function withoutDevice(object: HomeObject): HomeObject {
  const actions = object.actions.filter(action => action.type !== 'device' && action.type !== 'integration');
  const profile = object.experiences?.private;
  const privateActions = profile?.actions?.filter(action => action.type !== 'device' && action.type !== 'integration');
  return {...object, provider: undefined, actions: actions.length ? actions : [{type:'info'}],
    experiences: privateActions ? {...object.experiences!, private: {...profile!, actions: privateActions.length ? privateActions : [{type:'info'}]}} : object.experiences};
}

import type { HomeObject, VisitorAction } from './model.ts';

export type ExperienceMode = 'private' | 'showroom';

export function resolveObjectExperience(object: HomeObject, mode: ExperienceMode): HomeObject {
  const profile = object.experiences?.[mode];
  const fallbackActions = mode === 'showroom'
    ? object.actions.filter(isVisitorAction)
    : object.actions;
  return {
    ...object,
    name: profile?.title ?? object.name,
    description: profile?.description ?? object.description,
    mediaId: profile?.mediaId ?? object.mediaId,
    gallery: profile?.gallery ?? object.gallery,
    videoId: profile?.videoId ?? object.videoId,
    showcase: (profile?.showcase ?? object.showcase) as HomeObject['showcase'],
    actions: profile?.actions ?? (fallbackActions.length ? fallbackActions : [{ type: 'info' }]),
  };
}

export function mediaIdsForExperience(object: HomeObject, mode: ExperienceMode): string[] {
  const resolved = resolveObjectExperience(object, mode);
  return [resolved.mediaId, resolved.videoId, ...(resolved.gallery ?? [])].filter((id): id is string => !!id);
}

export function allObjectMediaIds(object: HomeObject): string[] {
  const profiles = [object.experiences?.private, object.experiences?.showroom];
  return Array.from(new Set([
    object.mediaId,
    object.videoId,
    ...(object.gallery ?? []),
    ...(object.documents ?? []).map(document => document.mediaId),
    ...(object.showcase ?? []).map(card => card.mediaId),
    ...profiles.flatMap(profile => profile ? [profile.mediaId, profile.videoId, ...(profile.gallery ?? []), ...(profile.showcase ?? []).map(card => card.mediaId)] : []),
  ].filter((id): id is string => !!id)));
}

export function isVisitorAction(action: HomeObject['actions'][number]): action is VisitorAction {
  return action.type === 'info' || action.type === 'portal' || action.type === 'demo' || action.type === 'link' || action.type === 'app';
}

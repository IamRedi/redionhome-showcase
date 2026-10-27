import type { Home, HomeObject } from './model.ts';

export function childrenOf(objects: HomeObject[], parentId: string) {
  return objects.filter(object => object.parentId === parentId);
}

export function ancestorIds(objects: HomeObject[], objectId: string) {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = objects.find(object => object.id === objectId);
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    result.unshift(current.parentId);
    current = objects.find(object => object.id === current?.parentId);
  }
  return result;
}

export function descendantIds(objects: HomeObject[], objectId: string) {
  const result: string[] = [];
  const queue = [objectId];
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const child of childrenOf(objects, parentId)) {
      result.push(child.id);
      queue.push(child.id);
    }
  }
  return result;
}

export function rootObject(objects: HomeObject[], objectId: string) {
  const path = ancestorIds(objects, objectId);
  return objects.find(object => object.id === (path[0] ?? objectId));
}

export function objectTrail(objects: HomeObject[], objectId: string) {
  return [...ancestorIds(objects, objectId), objectId]
    .map(id => objects.find(object => object.id === id))
    .filter((object): object is HomeObject => !!object);
}

export function rootHasHotspot(home: Home, objectId: string, sceneIds?: Set<string>) {
  const root = rootObject(home.objects, objectId);
  if (!root) return false;
  return home.scenes.some(scene => (!sceneIds || sceneIds.has(scene.id)) && scene.hotspots.some(hotspot => hotspot.objectId === root.id));
}

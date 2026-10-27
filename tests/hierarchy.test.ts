import { describe, expect, it } from 'vitest';
import { demoHome } from '../shared/demo.ts';
import { homeSchema } from '../shared/model.ts';
import { ancestorIds, childrenOf, objectTrail, rootObject } from '../shared/hierarchy.ts';

const clone = () => structuredClone(demoHome);

describe('universal object hierarchy', () => {
  it('supports deep object exploration without shelf-specific logic', () => {
    const result = homeSchema.safeParse(clone());
    expect(result.success).toBe(true);
    expect(ancestorIds(demoHome.objects, 'pliers')).toEqual(['shelf', 'drawer', 'tools']);
    expect(objectTrail(demoHome.objects, 'pliers').map(object => object.name)).toEqual(['Rafti i veglave', 'Sirtari i punës', 'Veglat', 'Pincat']);
    expect(childrenOf(demoHome.objects, 'drawer').map(object => object.id)).toEqual(['tools']);
    expect(rootObject(demoHome.objects, 'pliers')?.id).toBe('shelf');
  });

  it('rejects broken parent references', () => {
    const home = clone();
    home.objects.find(object => object.id === 'pliers')!.parentId = 'missing';
    expect(homeSchema.safeParse(home).error?.issues.some(issue => issue.message === 'Unknown object parent')).toBe(true);
  });

  it('rejects cyclic relationships', () => {
    const home = clone();
    home.objects.find(object => object.id === 'shelf')!.parentId = 'pliers';
    expect(homeSchema.safeParse(home).error?.issues.some(issue => issue.message === 'Object hierarchy cannot contain cycles')).toBe(true);
  });

  it('rejects child objects as panorama hotspots', () => {
    const home = clone();
    home.scenes[0].hotspots.push({ id: 'invalid-child-pin', objectId: 'drawer', position: { yaw: 0, pitch: 0 } });
    expect(homeSchema.safeParse(home).error?.issues.some(issue => issue.message === 'Hotspot object must be a root object in the room')).toBe(true);
  });

  it('rejects detail coordinates on a panorama root', () => {
    const home = clone();
    home.objects.find(object => object.id === 'shelf')!.detailPosition = { x: 50, y: 50 };
    expect(homeSchema.safeParse(home).error?.issues.some(issue => issue.message === 'Root object cannot have detail position')).toBe(true);
  });
});

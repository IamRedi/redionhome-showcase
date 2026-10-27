import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.ts';
import {UnifiedDeviceRegistry,type DeviceObservation} from '../server/unified-device-registry.ts';

let root:string,store:Store,registry:UnifiedDeviceRegistry;
const observation=(values:Partial<DeviceObservation>&Pick<DeviceObservation,'provider'|'externalId'|'name'>):DeviceObservation=>({category:'light',capabilities:['power'],commandCapabilities:values.provider==='home-assistant'?['power']:[],state:'off',availability:'online',values:{},observedAt:null,room:null,reason:null,...values});

beforeEach(()=>{root=mkdtempSync(path.join(os.tmpdir(),'redionhome-unified-'));store=new Store(root);registry=new UnifiedDeviceRegistry(store);});
afterEach(()=>{store.close();rmSync(root,{recursive:true,force:true});});

it('migrates a fresh store and keeps same-name provider identities separate',()=>{
 expect(store.db.prepare('SELECT version FROM migrations ORDER BY version DESC LIMIT 1').pluck().get()).toBe(8);
 registry.sync('home-assistant',[observation({provider:'home-assistant',externalId:'light.studio',name:'Drita e studios'})]);
 registry.sync('smartthings',[observation({provider:'smartthings',externalId:'80e26532-85d4-484c-b012-1c04f3d35f95',name:'Drita e studios'})]);
 const report=registry.report([]);
 expect(report.devices).toHaveLength(2);expect(report.totals.duplicateCandidates).toBe(2);
 expect(new Set(report.devices.map(device=>`${device.provider}:${device.externalId}`)).size).toBe(2);
 expect(report.devices.every(device=>device.objectId===null)).toBe(true);
});

it('marks a missing provider identity unavailable without deleting its history',()=>{
 registry.sync('home-assistant',[observation({provider:'home-assistant',externalId:'light.one',name:'One'}),observation({provider:'home-assistant',externalId:'sensor.two',name:'Two',category:'sensor',capabilities:['telemetry'],commandCapabilities:[],state:'21',values:{value:21}})]);
 registry.sync('home-assistant',[observation({provider:'home-assistant',externalId:'light.one',name:'One',state:'on'})]);
 expect(registry.list().find(device=>device.externalId==='sensor.two')).toMatchObject({availability:'unavailable',reason:'NOT_RETURNED_BY_PROVIDER',values:{value:21}});
});

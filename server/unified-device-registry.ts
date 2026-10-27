import type {Store} from './store.ts';
import type {DeviceCapability,DeviceCategory,DeviceProvider,DeviceValue,UnifiedDevice,UnifiedDiscoveryReport,ProviderDiscoveryResult} from '../shared/device-catalog.ts';

export type DeviceObservation={
  provider:DeviceProvider;
  externalId:string;
  name:string;
  category:DeviceCategory;
  capabilities:DeviceCapability[];
  commandCapabilities:DeviceCapability[];
  state:string;
  availability:UnifiedDevice['availability'];
  values:Record<string,DeviceValue>;
  observedAt:string|null;
  room:string|null;
  reason:string|null;
};

type DeviceRow={
  provider:DeviceProvider;externalId:string;name:string;category:DeviceCategory;
  capabilitiesJson:string;commandCapabilitiesJson:string;state:string;availability:UnifiedDevice['availability'];
  valuesJson:string;observedAt:string|null;room:string|null;reason:string|null;lastSeenAt:string;objectId:string|null;
};

const normalizedName=(value:string)=>value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export class UnifiedDeviceRegistry{
  constructor(private store:Store){}
  sync(provider:DeviceProvider,devices:DeviceObservation[]){
    const statement=this.store.db.prepare(`INSERT INTO unified_devices(provider,external_id,name,category,capabilities_json,command_capabilities_json,state,availability,values_json,observed_at,room,reason,last_seen_at)
      VALUES(@provider,@externalId,@name,@category,@capabilitiesJson,@commandCapabilitiesJson,@state,@availability,@valuesJson,@observedAt,@room,@reason,CURRENT_TIMESTAMP)
      ON CONFLICT(provider,external_id) DO UPDATE SET name=excluded.name,category=excluded.category,capabilities_json=excluded.capabilities_json,
      command_capabilities_json=excluded.command_capabilities_json,state=excluded.state,availability=excluded.availability,
      values_json=excluded.values_json,observed_at=excluded.observed_at,room=excluded.room,reason=excluded.reason,last_seen_at=CURRENT_TIMESTAMP`);
    this.store.db.transaction(()=>{
      this.store.db.prepare("UPDATE unified_devices SET availability='unavailable',reason='NOT_RETURNED_BY_PROVIDER' WHERE provider=?").run(provider);
      for(const device of devices)statement.run({...device,capabilitiesJson:JSON.stringify(device.capabilities),commandCapabilitiesJson:JSON.stringify(device.commandCapabilities),valuesJson:JSON.stringify(device.values)});
      this.store.audit('owner','devices.discovery',`${provider}:${devices.length}`);
    })();
  }
  list():UnifiedDevice[]{
    const rows=this.store.db.prepare(`SELECT u.provider,u.external_id AS externalId,u.name,u.category,u.capabilities_json AS capabilitiesJson,
      u.command_capabilities_json AS commandCapabilitiesJson,u.state,u.availability,u.values_json AS valuesJson,u.observed_at AS observedAt,
      u.room,u.reason,u.last_seen_at AS lastSeenAt,c.object_id AS objectId
      FROM unified_devices u LEFT JOIN provider_identities p ON p.provider=u.provider AND p.external_id=u.external_id
      LEFT JOIN canonical_devices c ON c.id=p.device_id ORDER BY u.name,u.provider,u.external_id`).all() as DeviceRow[];
    const duplicateKeys=new Map<string,Set<DeviceProvider>>();
    for(const row of rows){const key=`${row.category}:${normalizedName(row.name)}`;if(!normalizedName(row.name))continue;const providers=duplicateKeys.get(key)??new Set<DeviceProvider>();providers.add(row.provider);duplicateKeys.set(key,providers);}
    return rows.map(row=>({provider:row.provider,externalId:row.externalId,name:row.name,category:row.category,capabilities:JSON.parse(row.capabilitiesJson) as DeviceCapability[],commandCapabilities:JSON.parse(row.commandCapabilitiesJson) as DeviceCapability[],state:row.state,availability:row.availability,values:JSON.parse(row.valuesJson) as Record<string,DeviceValue>,observedAt:row.observedAt,room:row.room,objectId:row.objectId,duplicateCandidate:(duplicateKeys.get(`${row.category}:${normalizedName(row.name)}`)?.size??0)>1,reason:row.reason,lastSeenAt:row.lastSeenAt}));
  }
  report(providers:ProviderDiscoveryResult[]):UnifiedDiscoveryReport{
    const devices=this.list();
    return {devices,providers,totals:{devices:devices.length,online:devices.filter(device=>device.availability==='online').length,unavailable:devices.filter(device=>device.availability!=='online').length,controllable:devices.filter(device=>device.commandCapabilities.length>0&&device.availability==='online').length,linked:devices.filter(device=>!!device.objectId).length,duplicateCandidates:devices.filter(device=>device.duplicateCandidate).length}};
  }
}

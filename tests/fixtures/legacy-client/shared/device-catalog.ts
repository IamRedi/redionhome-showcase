export type DeviceProvider = "home-assistant" | "smartthings" | "tuya";

export type DeviceCategory =
  | "light"
  | "outlet"
  | "switch"
  | "sensor"
  | "thermostat"
  | "cover"
  | "media"
  | "fan"
  | "valve"
  | "lock"
  | "tv"
  | "printer"
  | "robot"
  | "piano"
  | "other";

export type DeviceCapability =
  | "power"
  | "brightness"
  | "color"
  | "temperature"
  | "humidity"
  | "energy"
  | "position"
  | "playback"
  | "volume"
  | "thermostat"
  | "telemetry"
  | "lock"
  | "external-view";

export type DeviceValue = string | number | boolean | null;

export type UnifiedDevice = {
  provider: DeviceProvider;
  externalId: string;
  name: string;
  category: DeviceCategory;
  capabilities: DeviceCapability[];
  commandCapabilities: DeviceCapability[];
  state: string;
  availability: "online" | "offline" | "unavailable" | "unknown";
  values: Record<string, DeviceValue>;
  observedAt: string | null;
  room: string | null;
  objectId: string | null;
  duplicateCandidate: boolean;
  reason: string | null;
  lastSeenAt: string;
};

export type ProviderDiscoveryResult = {
  provider: DeviceProvider;
  status: "connected" | "blocked" | "error";
  discovered: number;
  reason: string | null;
};

export type UnifiedDiscoveryReport = {
  devices: UnifiedDevice[];
  providers: ProviderDiscoveryResult[];
  totals: {
    devices: number;
    online: number;
    unavailable: number;
    controllable: number;
    linked: number;
    duplicateCandidates: number;
  };
};

export const deviceCategoryLabel: Record<DeviceCategory, string> = {
  light: "Dritë",
  outlet: "Prizë",
  switch: "Çelës",
  sensor: "Sensor",
  thermostat: "Termostat",
  cover: "Grilë / perde",
  media: "Media",
  fan: "Ventilator",
  valve: "Valvul",
  lock: "Bravë",
  tv: "TV",
  printer: "Printer",
  robot: "Robot",
  piano: "Piano",
  other: "Pajisje",
};

export function deviceCategoryFromDomain(domain: string, name = "", deviceClass = ""): DeviceCategory {
  const hint = `${name} ${deviceClass}`.toLocaleLowerCase();
  if (domain === "light") return "light";
  if (domain === "switch") return /plug|socket|outlet|priz/.test(hint) ? "outlet" : "switch";
  if (domain === "sensor" || domain === "binary_sensor") return "sensor";
  if (domain === "climate") return "thermostat";
  if (domain === "cover") return "cover";
  if (domain === "media_player") return /\btv\b|television|televiz/.test(hint) ? "tv" : "media";
  if (domain === "fan") return "fan";
  if (domain === "valve") return "valve";
  if (domain === "lock") return "lock";
  return "other";
}

export function objectKindFromDeviceCategory(category: DeviceCategory) {
  if (category === "outlet") return "outlet" as const;
  if (category === "media") return "media" as const;
  if (category === "other") return "generic" as const;
  return category;
}

import type { DeviceSnapshot, DeviceState, HomeObject, Role } from "../shared/model.ts";

export type ObjectKind = NonNullable<HomeObject["kind"]>;

const categoryMatchers: Array<[ObjectKind, RegExp]> = [
  ["light", /\b(light|lamp|drit|llamb|g95)\b/i],
  ["outlet", /\b(outlet|plug|socket|priz|çelës|switch)\b/i],
  ["sensor", /\b(sensor|mat(ë|e)s|temperature|humidity)\b/i],
  ["thermostat", /\b(thermostat|termostat|climate|klim)\b/i],
  ["cover", /\b(cover|blind|shutter|gril|perde)\b/i],
  ["media", /\b(media|speaker|audio|cast)\b/i],
  ["fan", /\b(fan|ventilator)\b/i],
  ["valve", /\b(valve|valvul)\b/i],
  ["lock", /\b(lock|brav)\b/i],
  ["tv", /\b(tv|television|televizor|screen|ekran)\b/i],
  ["piano", /\b(piano|keyboard|klavier)\b/i],
  ["shelf", /\b(shelf|raft|shelving)\b/i],
  ["drawer", /\b(drawer|sirtar)\b/i],
  ["tool", /\b(tool|veg(ë|e)l|pinc|hammer|çekiç)\b/i],
  ["photo", /\b(photo|picture|art|tablo|foto)\b/i],
  ["door", /\b(door|der(ë|e)|portal)\b/i],
  ["fridge", /\b(fridge|refrigerator|frigorifer)\b/i],
  ["cabinet", /\b(cabinet|cupboard|dollap)\b/i],
  ["printer", /\b(printer|printim)\b/i],
  ["robot", /\brobot\b/i],
  ["product", /\b(product|produkt)\b/i],
];

export function objectKind(object: HomeObject): ObjectKind {
  if (object.kind) return object.kind;
  if (object.actions.some((action) => action.type === "portal")) return "door";
  if (object.actions.some((action) => action.type === "device")) {
    const text = `${object.name} ${object.category ?? ""}`;
    return /priz|plug|outlet|socket|switch|çelës/i.test(text) ? "outlet" : "light";
  }
  const text = `${object.name} ${object.category ?? ""}`;
  return categoryMatchers.find(([, matcher]) => matcher.test(text))?.[0] ?? "generic";
}

export const objectKindLabel: Record<ObjectKind, string> = {
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
  piano: "Piano",
  shelf: "Raft",
  drawer: "Sirtar",
  tool: "Vegël",
  photo: "Foto / tablo",
  door: "Derë / kalim",
  fridge: "Frigorifer",
  cabinet: "Dollap",
  printer: "Printer",
  robot: "Robot",
  product: "Produkt",
  generic: "Objekt",
};

// Trusted, fixed Lucide-style paths. No object-authored text enters this markup.
export const objectIconMarkup: Record<ObjectKind, string> = {
  light: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.2 14.5a6 6 0 1 1 7.6 0c-.8.7-1.3 1.6-1.5 2.5H9.7c-.2-.9-.7-1.8-1.5-2.5Z"/>',
  outlet: '<path d="M8 12v4"/><path d="M16 12v4"/><path d="M7 8h10a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-7a2 2 0 0 1 2-2Z"/>',
  switch: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 12h8"/><circle cx="9" cy="12" r="2"/>',
  sensor: '<path d="M12 3v2m0 14v2M3 12h2m14 0h2"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4"/>',
  thermostat: '<path d="M10 5a2 2 0 1 1 4 0v8.2a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>',
  cover: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M4 13h16M4 18h16"/>',
  media: '<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="7" r="1"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c-1-5 2-7 5-6 2 3 0 6-3 8m-4 0c-5-1-7 2-6 5 3 2 6 0 8-3m0 0c1 5-2 7-5 6-2-3 0-6 3-8"/>',
  valve: '<path d="M4 12h16M7 9v6m10-6v6M9 5h6M12 5v7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  tv: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="m8 22 4-4 4 4"/>',
  piano: '<path d="M4 18V6h16v12"/><path d="M4 14h16"/><path d="M8 14V6m4 8V6m4 8V6"/><path d="M7 22v-4m10 4v-4"/>',
  shelf: '<path d="M4 4v17m16-17v17M4 8h16M4 14h16M4 20h16"/>',
  drawer: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M11 7h2M11 12h2M11 17h2"/>',
  tool: '<path d="m14.7 6.3 3-3a4.2 4.2 0 0 1-5.4 5.4L5 16l-2 5 5-2 7.3-7.3a4.2 4.2 0 0 1 5.4-5.4l-3 3"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>',
  door: '<path d="M4 21h16M6 21V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17"/><circle cx="14" cy="12" r=".7"/>',
  fridge: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 9h14M9 5v1m0 7v3"/>',
  cabinet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 3v18M9 12h1m4 0h1"/>',
  printer: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8" rx="1"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
  robot: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M12 2v4M8 12h.01M16 12h.01M9 16h6M2 10h2m16 0h2"/>',
  product: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/>',
  generic: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9h6v6H9z"/>',
};

export function deviceForObject(object: HomeObject, devices: DeviceSnapshot | null): DeviceState | undefined {
  const action = object.actions.find((candidate) => candidate.type === "device");
  return action?.type === "device"
    ? devices?.entities.find((entity) => entity.bindingId === action.bindingId)
    : undefined;
}

export function canControlDevice(device: DeviceState | undefined, role: Role): boolean {
  if (!device || device.state === "unavailable") return false;
  if (!device.commandCapabilities?.includes("power") && !device.capabilities?.includes("power")) return false;
  if (device.source === "smartthings" || device.source === "tuya") return false;
  if (device.source === "home-assistant") return role === "owner" && device.controlEnabled === true;
  return (role === "owner" || role === "household") && device.source === "mock";
}

export function isQuickToggleLight(object: HomeObject, device: DeviceState | undefined, role: Role): boolean {
  return objectKind(object) === "light" && canControlDevice(device, role);
}

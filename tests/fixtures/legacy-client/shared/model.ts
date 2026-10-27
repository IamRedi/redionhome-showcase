import { z } from "zod";
import type { DeviceCapability, DeviceCategory, DeviceValue } from "./device-catalog.ts";
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const id = idSchema;
const text = z.string().trim().min(1).max(120);
export const visibilitySchema = z.enum(["private", "invited", "public"]);
export const providerSchema = z.enum(["mock", "home-assistant", "smartthings", "tuya", "matter", "mqtt", "vendor", "piano-core", "led-wall", "bambu-lab", "hugo"]);
export const safeLinkSchema = z.string().max(1000).refine((value) => {
  try {
    const u = new URL(value);
    const h = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.username && !u.password &&
      /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) &&
      !h.endsWith(".local") && !h.endsWith(".localhost") && !h.endsWith(".internal");
  } catch { return false; }
}, "Use a public HTTPS URL without credentials");
// Private Home profile links stay owner-only and are never exported to a publication,
// so local hosts, explicit ports, query strings and fragments are allowed here.
export const privateLinkSchema = z.string().max(1000).refine((value) => {
  if (/[\s<>]/.test(value)) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
  } catch { return false; }
}, "Use an HTTP or HTTPS URL without credentials");
const appSchemes = new Set(["spotify", "youtube", "instagram", "fb", "linkedin"]);
export const safeAppLinkSchema = z.string().max(1000).refine((value) => {
  if (/\s/.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (!scheme || !appSchemes.has(scheme)) return false;
  try {
    const u = new URL(value);
    return !u.username && !u.password;
  } catch { return false; }
}, "Use a supported app link: spotify, youtube, instagram, fb or linkedin");
export const positionSchema = z
  .object({
    yaw: z
      .number()
      .min(-Math.PI * 2)
      .max(Math.PI * 2),
    pitch: z
      .number()
      .min(-Math.PI / 2)
      .max(Math.PI / 2),
  })
  .strict();
export const objectKindSchema = z.enum([
  "light",
  "outlet",
  "switch",
  "sensor",
  "thermostat",
  "cover",
  "media",
  "fan",
  "valve",
  "lock",
  "tv",
  "piano",
  "shelf",
  "drawer",
  "tool",
  "photo",
  "door",
  "fridge",
  "cabinet",
  "printer",
  "robot",
  "product",
  "generic",
]);
export const detailPositionSchema = z
  .object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
  })
  .strict();
const infoActionSchema = z.object({ type: z.literal("info") }).strict();
const portalActionSchema = z.object({ type: z.literal("portal"), sceneId: id }).strict();
const demoActionSchema = z.object({ type: z.literal("demo"), demo: z.enum(["piano", "led-wall", "robot", "fridge"]) }).strict();
const linkActionSchema = z.object({ type: z.literal("link"), label: text, url: safeLinkSchema }).strict();
const appActionSchema = z.object({ type: z.literal("app"), label: text, url: safeAppLinkSchema, fallbackUrl: safeLinkSchema }).strict();
const deviceActionSchema = z.object({ type: z.literal("device"), bindingId: id }).strict();
const integrationActionSchema = z.object({ type: z.literal("integration"), adapterId: providerSchema }).strict();
const privateLinkActionSchema = z.object({ type: z.literal("link"), label: text, url: privateLinkSchema }).strict();
const privateAppActionSchema = z.object({ type: z.literal("app"), label: text, url: safeAppLinkSchema, fallbackUrl: privateLinkSchema }).strict();
export const privateActionSchema = z.discriminatedUnion("type", [
  infoActionSchema,
  portalActionSchema,
  demoActionSchema,
  privateLinkActionSchema,
  privateAppActionSchema,
  deviceActionSchema,
  integrationActionSchema,
]);
export const visitorActionSchema = z.discriminatedUnion("type", [
  infoActionSchema,
  portalActionSchema,
  demoActionSchema,
  linkActionSchema,
  appActionSchema,
]);
export const actionSchema = z.discriminatedUnion("type", [
  infoActionSchema,
  portalActionSchema,
  demoActionSchema,
  linkActionSchema,
  appActionSchema,
  deviceActionSchema,
  integrationActionSchema,
]);
export const showcaseBrandSchema = z.enum(["portfolio", "github", "youtube", "instagram", "linkedin", "facebook", "spotify", "piano", "led-wall", "hugo-eye", "demo"]);
export const showcaseCardSchema = z.object({
  id,
  title: text,
  description: z.string().max(280).optional(),
  brand: showcaseBrandSchema,
  mediaId: id.optional(),
  action: visitorActionSchema,
}).strict();
const experienceMedia = {
  title: text.optional(),
  description: z.string().max(2000).optional(),
  mediaId: id.optional(),
  gallery: z.array(id).max(20).optional(),
  videoId: id.optional(),
  showcase: z.array(showcaseCardSchema).max(12).optional(),
};
const privateCardActionSchema = z.union([visitorActionSchema, privateLinkActionSchema, privateAppActionSchema]);
const privateShowcaseCardSchema = z.object({
  id,
  title: text,
  description: z.string().max(280).optional(),
  brand: showcaseBrandSchema,
  mediaId: id.optional(),
  action: privateCardActionSchema,
}).strict();
// Journal entries live only on the owner's private profile; the showroom publication
// copies explicit fields only, so they are structurally excluded from every export.
export const journalEntrySchema = z.object({
  id,
  at: z.number().int().positive(),
  text: z.string().trim().min(1).max(2000),
}).strict();
const privateExperienceSchema = z.object({
  version: z.literal(1),
  title: text.optional(),
  description: z.string().max(2000).optional(),
  mediaId: id.optional(),
  gallery: z.array(id).max(20).optional(),
  videoId: id.optional(),
  showcase: z.array(privateShowcaseCardSchema).max(12).optional(),
  actions: z.array(privateActionSchema).min(1).max(8).optional(),
  journal: z.array(journalEntrySchema).max(50).optional(),
}).strict();
const showroomExperienceSchema = z.object({
  version: z.literal(1),
  ...experienceMedia,
  actions: z.array(visitorActionSchema).min(1).max(8).optional(),
}).strict();
export const objectExperiencesSchema = z.object({
  version: z.literal(1),
  private: privateExperienceSchema.optional(),
  showroom: showroomExperienceSchema.optional(),
}).strict();
export const objectSchema = z
  .object({
    id,
    roomId: id,
    name: text,
    description: z.string().max(2000),
    mediaId: id.optional(),
    mediaType: z.enum(["photo", "video"]).optional(),
    category: z.string().min(1).max(80).optional(),
    kind: objectKindSchema.optional(),
    parentId: id.optional(),
    detailPosition: detailPositionSchema.optional(),
    visibility: visibilitySchema.optional(),
    gallery: z.array(id).max(20).optional(),
    videoId: id.optional(),
    showcase: z.array(showcaseCardSchema).max(12).optional(),
    specifications: z.array(z.object({ label: z.string().min(1).max(100), value: z.string().max(500) }).strict()).max(30).optional(),
    documentation: z.string().max(5000).optional(),
    documents: z.array(z.object({id,mediaId:id,title:z.string().trim().min(1).max(120),mime:z.enum(['application/pdf','text/plain']),visibility:visibilitySchema}).strict()).max(20).optional(),
    photoSuggestionId: id.optional(),
    capabilities: z.array(z.enum(["gallery", "video", "specifications", "virtual-demo", "device-control", "external-view", "inventory"])).max(8).optional(),
    provider: z.object({ identity: id, active: providerSchema, status: z.enum(["unconfigured", "mock", "planned", "configured"])}).strict().optional(),
    permissions: z.object({ householdControl: z.boolean(), householdView: z.boolean() }).strict().optional(),
    actions: z.array(actionSchema).min(1).max(8),
    experiences: objectExperiencesSchema.optional(),
  })
  .strict();
export const hotspotSchema = z
  .object({ id, objectId: id, position: positionSchema })
  .strict();
export const sceneSchema = z
  .object({
    id,
    roomId: id,
    name: text,
    mediaId: id,
    initial: positionSchema,
    visibility: visibilitySchema.optional(),
    hotspots: z.array(hotspotSchema).max(100),
  })
  .strict();
export const homeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    name: text,
    revision: z.number().int().positive(),
    demo: z.boolean(),
    floors: z
      .array(z.object({ id, name: text }).strict())
      .min(1)
      .max(10),
    rooms: z
      .array(z.object({ id, floorId: id, name: text }).strict())
      .min(1)
      .max(100),
    scenes: z.array(sceneSchema).min(1).max(200),
    objects: z.array(objectSchema).max(1000),
  })
  .strict()
  .superRefine((home, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    for (const list of [
      home.floors,
      home.rooms,
      home.scenes,
      home.objects,
      ...home.scenes.map((s) => s.hotspots),
    ])
      if (new Set(list.map((i) => i.id)).size !== list.length)
        fail("Duplicate id");
    for (const room of home.rooms)
      if (!home.floors.some((f) => f.id === room.floorId))
        fail("Unknown floor");
    for (const object of home.objects) {
      if(new Set((object.documents??[]).map(d=>d.id)).size!==(object.documents??[]).length)fail('Duplicate document id');
      if (!home.rooms.some((r) => r.id === object.roomId))
        fail("Unknown object room");
      if (object.parentId) {
        const parent = home.objects.find((candidate) => candidate.id === object.parentId);
        if (!parent) fail("Unknown object parent");
        else if (parent.roomId !== object.roomId) fail("Object parent must belong to room");
      } else if (object.detailPosition) fail("Root object cannot have detail position");
      const actionGroups = [object.actions, object.experiences?.private?.actions ?? [], object.experiences?.showroom?.actions ?? []];
      for (const action of actionGroups.flat())
        if (
          action.type === "portal" &&
          !home.scenes.some((s) => s.id === action.sceneId)
        )
          fail("Unknown destination");
    }
    const byId = new Map(home.objects.map((object) => [object.id, object]));
    for (const object of home.objects) {
      const visited = new Set<string>([object.id]);
      let parentId = object.parentId;
      let depth = 0;
      while (parentId) {
        if (visited.has(parentId)) {
          fail("Object hierarchy cannot contain cycles");
          break;
        }
        visited.add(parentId);
        depth += 1;
        if (depth > 8) {
          fail("Object hierarchy is too deep");
          break;
        }
        parentId = byId.get(parentId)?.parentId;
      }
    }
    for (const scene of home.scenes) {
      if (!home.rooms.some((r) => r.id === scene.roomId))
        fail("Unknown scene room");
      for (const hotspot of scene.hotspots)
        if (
          !home.objects.some(
            (o) => o.id === hotspot.objectId && o.roomId === scene.roomId && !o.parentId,
          )
        )
          fail("Hotspot object must be a root object in the room");
    }
  });
export type Home = z.infer<typeof homeSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type HomeObject = z.infer<typeof objectSchema>;
export type VisitorAction = z.infer<typeof visitorActionSchema>;
export type PrivateAction = z.infer<typeof privateActionSchema>;
export type ShowcaseCard = z.infer<typeof showcaseCardSchema>;
export type PrivateShowcaseCard = z.infer<typeof privateShowcaseCardSchema>;
export type Hotspot = z.infer<typeof hotspotSchema>;
export type Position = z.infer<typeof positionSchema>;
export type Role = "owner" | "viewer" | "household" | "invited_guest" | "public_viewer";
export type DeviceState = {
  bindingId: string;
  entityId?: string;
  name: string;
  state: "on" | "off" | "available" | "unavailable";
  source: "mock" | "home-assistant" | "smartthings" | "tuya";
  observedAt?: string | null;
  category?: DeviceCategory;
  availability?: "online" | "offline" | "unavailable" | "unknown";
  statusText?: string;
  values?: Record<string, DeviceValue>;
  capabilities?: DeviceCapability[];
  commandCapabilities?: DeviceCapability[];
  controlEnabled?: boolean;
  brightness?: number | null;
};
export type DeviceSnapshot = {
  mode: "mock" | "readonly" | "unconfigured";
  connection: "online" | "offline" | "unconfigured";
  entities: DeviceState[];
};
export type ProviderId = 'mock' | 'home-assistant' | 'smartthings' | 'tuya' | 'matter' | 'mqtt' | 'vendor' | 'piano-core' | 'led-wall' | 'bambu-lab' | 'hugo';
export type Capability = DeviceCapability;
export type ProviderAvailability = 'online' | 'offline' | 'unconfigured';
export type DiscoveredDevice = {
    identity: string;
    provider: ProviderId;
    binding: string;
    capabilities: Capability[];
};
export type ProviderState = {
    identity: string;
    availability: ProviderAvailability;
    values: Record<string, string | number | boolean>;
    observedAt: number;
};
// Authentication stays in server-owned configuration, never the object/showroom DTO.
export interface UniversalProvider {
    id: ProviderId;
    kind: 'mock' | 'physical';
    discover(): Promise<DiscoveredDevice[]>;
    state(binding: string): Promise<ProviderState>;
    availability(): Promise<ProviderAvailability>;
    authenticate(): Promise<boolean>;
    reconnect(signal: AbortSignal): Promise<void>;
    action(binding: string, capability: Capability, value: unknown): Promise<void>;
}

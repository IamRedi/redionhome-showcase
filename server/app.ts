import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { rateLimit } from "express-rate-limit";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { homeSchema, positionSchema, type Home, type Role } from "../shared/model.ts";
import {bindingEditSchema, editBinding} from "./binding-edit.ts";
import { Store } from "./store.ts";
import { mountTours, type Identity } from "./tours.ts";
import { grantSchema } from "../shared/access.ts";
import { ancestorIds, rootHasHotspot } from "../shared/hierarchy.ts";
import { importObjectMedia } from "./object-media.ts";
import { providerCatalog } from "./provider-registry.ts";
import { mountBuilder } from './builder.ts';
import { importDocument, documentDownloadHeaders } from './documents.ts';
import { mountPhotoAssistant } from './photo-assistant.ts';
import type { PhotoSuggestionProvider } from '../shared/photo-assistant.ts';
import { phoneOrigin } from './phone-access.ts';
import { HomeAssistantPilot } from './home-assistant.ts';
import { DeviceRegistry } from './device-registry.ts';
import { SmartThingsReadOnly, supportsSwitch } from './smartthings.ts';
import { TuyaReadOnly, supportsTuyaSwitch } from './tuya.ts';
import { UnifiedDeviceRegistry,type DeviceObservation } from './unified-device-registry.ts';
import {deviceCategoryFromDomain,deviceCategoryLabel,objectKindFromDeviceCategory,type ProviderDiscoveryResult} from '../shared/device-catalog.ts';
import { allObjectMediaIds } from '../shared/experience.ts';
import { mountAI, type AIProvider } from './ai.ts';
import {Actions,mountActions,manualCommandSchema} from './actions.ts';
import {ActionError,commandDispatcher} from './commands.ts';
import {ProductIntegrations,mountProductIntegrations} from './product-integrations.ts';
import {
  MockAdapter,
  integrationCatalog,
  type DeviceAdapter,
} from "./adapters.ts";
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function verify(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function createApp(options: {
  root: string;
  origin: string;
  password?: string;
  adapter?: DeviceAdapter;
  production?: boolean;
  photoProvider?: PhotoSuggestionProvider;
  photoTimeoutMs?: number;
  aiProvider?: AIProvider;
  aiTimeoutMs?: number;
  actionTimeoutMs?: number;
  haAllowedOrigins?: string[];
  haTokenFile?: string;
  haApprovedLightId?: string;
  haFetch?: typeof fetch;
  haSocketFactory?: (url:string)=>WebSocket;
  smartthingsTokenFile?: string;
  smartthingsFetch?: typeof fetch;
  smartthingsNow?: ()=>number;
  tuyaConfigFile?: string;
  tuyaFetch?: typeof fetch;
  tuyaNow?: ()=>number;
  loginRateLimit?: number;
  runtimeLabel?: string;
  productFetch?: typeof fetch;
  productConnections?: unknown;
}) {
  const store = new Store(options.root),
    app = express(),
    adapter = options.adapter ?? new MockAdapter();
  const ha = new HomeAssistantPilot(store,options.haAllowedOrigins??[],options.haTokenFile,options.haFetch,options.haSocketFactory,options.haApprovedLightId);
  const registry = new DeviceRegistry(store);
  const unified = new UnifiedDeviceRegistry(store);
  const smartthings = new SmartThingsReadOnly(options.smartthingsTokenFile,options.smartthingsFetch,options.smartthingsNow);
  const tuya = new TuyaReadOnly(options.tuyaConfigFile,options.tuyaFetch,options.tuyaNow);
  const origin = new URL(options.origin);
  if (!store.user("owner")) {
    const password = options.password ?? randomBytes(24).toString("base64url");
    if (password.length < 12)
      throw Error("Owner password must have at least 12 characters");
    store.db
      .prepare("INSERT INTO users VALUES(?,?,?)")
      .run("owner", passwordHash(password), "owner");
    if (!options.password)
      writeFileSync(
        path.join(options.root, "owner-password.txt"),
        password + "\n",
        { mode: 0o600, flag: "wx" },
      );
  }
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
      "Content-Security-Policy": `default-src 'self'; script-src 'self'${options.production ? "" : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'${options.production ? "" : " ws://127.0.0.1:* ws://localhost:*"}; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    });
    const requestOrigin=[origin,phoneOrigin(options.root)].find(o=>o&&req.headers.host===o.host);
    if (!requestOrigin) {
      res.status(403).json({ error: "HOST_NOT_ALLOWED" });
      return;
    }
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin !== requestOrigin.origin
    ) {
      res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
      return;
    }
    res.locals.requestOrigin=requestOrigin;
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  if (process.env.REDIONHOME_SHOWCASE === '1') {
    app.use((req,res,next)=>{
      res.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
      if (!['GET','HEAD','OPTIONS'].includes(req.method) &&
          (req.path.startsWith('/api/v1/integrations') || req.path.startsWith('/api/v1/phone'))) {
        res.status(403).json({error:'SHOWCASE_EXTERNAL_SERVICES_DISABLED'});return;
      }
      next();
    });
  }
  const identity = (req: Request): Identity | undefined => {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("roh_session="))
      ?.slice(12);
    if (!token) return;
    const row = store.db
      .prepare(
        "SELECT users.id,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?",
      )
      .get(digest(token), Date.now()) as Identity | undefined;
    if(!row) return;
    const access=store.db.prepare('SELECT * FROM access WHERE user_id=?').get(row.id) as {role:Role;grant_json:string;expires:number;revoked:number}|undefined;
    if(access) {
      if(access.revoked || access.expires<=Date.now())return;
      return {id:row.id,role:access.role,grant:grantSchema.parse(JSON.parse(access.grant_json))};
    }
    return row;
  };
  const auth =
    (owner = false) =>
    (req: Request, res: Response, next: NextFunction) => {
      const user = identity(req);
      if (!user) {
        res.status(401).json({ error: "AUTH_REQUIRED" });
        return;
      }
      if (owner && user.role !== "owner") {
        res.status(403).json({ error: "OWNER_REQUIRED" });
        return;
      }
      res.locals.user = user;
      res.locals.sessionHash = digest(req.headers.cookie?.split(";").map(x=>x.trim()).find(x=>x.startsWith("roh_session="))?.slice(12)??"");
      next();
    };
  app.get("/api/v1/health", (_req, res) =>
    res.json({ status: "ok", apiVersion: 1 }),
  );
  app.post(
    "/api/v1/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: options.loginRateLimit ?? 15,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    (req, res) => {
      const input = z
        .object({
          username: z.string().regex(/^[\w-]{1,80}$/).default("owner"),
          password: z.string().min(1).max(256),
        })
        .strict()
        .parse(req.body);
      const user = store.user(input.username);
      if (!user || user.password_hash === "invitation-only" || !verify(input.password, user.password_hash)) {
        store.audit("anonymous", "auth.failed", "");
        res.status(401).json({ error: "INVALID_CREDENTIALS" });
        return;
      }
      const token = randomBytes(32).toString("hex");
      store.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      // Password sessions are bounded too; newest login retires oldest sessions.
      const old=store.db.prepare('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires DESC').all(user.id) as {token_hash:string}[];
      for(const entry of old.slice(7)) store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(entry.token_hash);
      store.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(digest(token), user.id, Date.now() + 12 * 60 * 60 * 1000);
      res.cookie("roh_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: (res.locals.requestOrigin as URL).protocol === "https:",
        maxAge: 12 * 60 * 60 * 1000,
        path: "/",
      });
      store.audit(user.id, "auth.login", "");
      res.json({ id: user.id, role: user.role });
    },
  );
  app.get("/api/v1/session", auth(), (_req, res) => res.json(res.locals.user));
  // Owner-only, sanitized candidate marker. It intentionally exposes no host,
  // datastore, process, or credential information.
  app.get("/api/v1/runtime-info", auth(true), (_req, res) =>
    res.json({ label: options.runtimeLabel ?? null }),
  );
  app.post("/api/v1/logout", auth(), (req, res) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("roh_session="))
      ?.slice(12);
    if (token)
      store.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(digest(token));
    res.clearCookie("roh_session", { path: "/" });
    res.status(204).end();
  });
  const privateAuth: ReturnType<typeof auth> = (req,res,next) => auth()(req,res,()=>{
    const u=res.locals.user as Identity;
    if(u.role==='invited_guest'||u.role==='public_viewer'){if(req.path==='/v1/commands')store.audit(u.id,'command.denied','PRIVATE_HOME_REQUIRED');res.status(403).json({error:'PRIVATE_HOME_REQUIRED'});return;}
    next();
  });
  const permittedHome=(u:Identity)=>{
    const h=store.home();
    if(u.role!=='household')return h;
    const scenes=h.scenes.filter(s=>u.grant?.sceneIds.includes(s.id));
    const sceneIds=new Set(scenes.map(scene=>scene.id));
    const allowedIds=new Set(h.objects.filter(o=>u.grant?.objectIds.includes(o.id)&&o.permissions?.householdView===true&&rootHasHotspot(h,o.id,sceneIds)&&ancestorIds(h.objects,o.id).every(id=>u.grant?.objectIds.includes(id)&&h.objects.find(parent=>parent.id===id)?.permissions?.householdView===true)).map(o=>o.id));
    const objects=h.objects.filter(o=>allowedIds.has(o.id)).map(o=>({...o,documents:o.documents?.filter(d=>d.visibility!=='private'),actions:o.actions.filter(a=>a.type!=='portal'||scenes.some(s=>s.id===a.sceneId))}));
    return {...h,scenes:scenes.map(s=>({...s,hotspots:s.hotspots.filter(p=>objects.some(o=>o.id===p.objectId))})),objects,rooms:h.rooms.filter(r=>scenes.some(s=>s.roomId===r.id)),floors:h.floors.filter(f=>h.rooms.some(r=>r.floorId===f.id&&scenes.some(s=>s.roomId===r.id)))};
  };
  const permittedMedia=(u:Identity)=>{
    const h=permittedHome(u);
    return new Set([...h.scenes.map(s=>s.mediaId),...h.objects.flatMap(o=>[o.mediaId,o.videoId,...(o.gallery??[]),...(o.documents??[]).map(d=>d.mediaId)].filter((x):x is string=>!!x))]);
  };
  const deviceSnapshotFor=async(u:Identity)=>{
    const snapshot=await adapter.snapshot();
    const bindings=permittedHome(u).objects.flatMap(o=>o.actions.flatMap(a=>a.type==='device'?[a.bindingId]:[]));
    const smartStates=await Promise.all(registry.smartthingsBindings().filter(b=>b.primaryProvider==='smartthings'&&bindings.includes(b.deviceId)).map(async b=>{
      try{const state=await smartthings.state(b.externalId);return {bindingId:b.deviceId,entityId:b.externalId,name:store.home().objects.find(o=>o.id===b.objectId)?.name??'SmartThings device',state:state.state,observedAt:state.observedAt,source:'smartthings' as const};}
      catch{return {bindingId:b.deviceId,entityId:b.externalId,name:store.home().objects.find(o=>o.id===b.objectId)?.name??'SmartThings device',state:'unavailable' as const,source:'smartthings' as const};}
    }));
    const tuyaStates=await Promise.all(registry.tuyaBindings().filter(b=>b.primaryProvider==='tuya'&&bindings.includes(b.deviceId)).map(async b=>{
      try{const state=await tuya.state(b.externalId);return {bindingId:b.deviceId,entityId:b.externalId,name:store.home().objects.find(o=>o.id===b.objectId)?.name??'Smart Life device',state:state.state,observedAt:state.observedAt,source:'tuya' as const};}
      catch{return {bindingId:b.deviceId,entityId:b.externalId,name:store.home().objects.find(o=>o.id===b.objectId)?.name??'Smart Life device',state:'unavailable' as const,source:'tuya' as const};}
    }));
    const activeBindings=new Set(store.home().objects.flatMap(o=>o.actions.flatMap(a=>a.type==='device'?[a.bindingId]:[])));
    const entities=[...snapshot.entities.filter(e=>activeBindings.has(e.bindingId)),...(u.role==='viewer'?[]:ha.snapshot()),...smartStates,...tuyaStates];
    return {...snapshot,entities:u.role==='owner'?entities:entities.filter(e=>bindings.includes(e.bindingId))};
  };
  const freshSnapshot=async(fresh=false)=>{if(fresh&&ha.info().configured)try{await ha.refresh();}catch{/* Failed refresh clears HA state; execution reports unavailable. */}const base=await adapter.snapshot();return {...base,entities:[...base.entities,...ha.snapshot()]};};
  const actions=new Actions(store,freshSnapshot,commandDispatcher(store,ha,adapter,permittedHome),(session,actor)=>!!store.db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires>?').get(session,actor,Date.now()),options.actionTimeoutMs);
  mountActions(app,actions,store,auth(true));
  const products=new ProductIntegrations(store,options.root,ha,options.productFetch,options.productConnections);
  mountProductIntegrations(app,products,auth(true));
  mountTours(app,store,options.root,auth(true),identity,origin);
  mountBuilder(app,store,options.root,auth(true));
  mountPhotoAssistant(app,store,options.root,auth(true),options.photoProvider,options.photoTimeoutMs);
  mountAI(app,store,options.root,auth(true),()=>deviceSnapshotFor({id:'owner',role:'owner'}),options.aiProvider,options.aiTimeoutMs,actions,()=>products.aiContext());
  app.get('/api/v1/phone-access',auth(true),(_req,res)=>res.json({origin:phoneOrigin(options.root)?.origin??null,physicalAcceptance:'NOT_VERIFIED',device:'Samsung S24 Ultra',publicExposure:false}));
  app.get("/api/v1/providers", privateAuth, (_req,res)=>res.json(providerCatalog));
  app.get('/api/v1/device-registry',auth(true),(_req,res)=>res.json(registry.list()));
  app.get('/api/v1/unified-devices',auth(true),(_req,res)=>res.json(unified.report([])));
  app.post('/api/v1/unified-devices/discover',auth(true),async(_req,res)=>{
    const results:ProviderDiscoveryResult[]=[];
    if(ha.info().configured){
      try{
        const rows=await ha.inventory();
        unified.sync('home-assistant',rows.map(row=>({provider:'home-assistant',externalId:row.entityId,name:row.name,category:row.category,capabilities:row.capabilities,commandCapabilities:row.commandCapabilities,state:row.rawState,availability:row.availability,values:row.values,observedAt:row.observedAt,room:null,reason:row.availability==='online'?null:'PROVIDER_UNAVAILABLE'})));
        results.push({provider:'home-assistant',status:'connected',discovered:rows.length,reason:null});
      }catch(e){results.push({provider:'home-assistant',status:'error',discovered:0,reason:e instanceof Error?e.message:'HA_UNAVAILABLE'});}
    }else results.push({provider:'home-assistant',status:'blocked',discovered:0,reason:'HA_UNCONFIGURED'});
    if(smartthings.configured()){
      try{
        const rows=await smartthings.discover(),observations:DeviceObservation[]=[];
        for(const row of rows){
          const name=row.label??row.name??'SmartThings device',power=supportsSwitch(row);
          let state:'on'|'off'|'unavailable'='unavailable',observedAt:string|null=null,reason:string|null=power?null:'CAPABILITY_UNSUPPORTED';
          if(power)try{const current=await smartthings.state(row.deviceId);state=current.state;observedAt=current.observedAt;reason=state==='unavailable'?'PROVIDER_UNAVAILABLE':null;}catch(e){reason=e instanceof Error?e.message:'ST_UNAVAILABLE';}
          observations.push({provider:'smartthings',externalId:row.deviceId,name,category:deviceCategoryFromDomain(power?'switch':'unknown',name),capabilities:power?['power']:[],commandCapabilities:[],state,availability:state==='unavailable'?'unavailable':'online',values:{},observedAt,room:null,reason});
        }
        unified.sync('smartthings',observations);results.push({provider:'smartthings',status:'connected',discovered:rows.length,reason:null});
      }catch(e){results.push({provider:'smartthings',status:'error',discovered:0,reason:e instanceof Error?e.message:'ST_UNAVAILABLE'});}
    }else results.push({provider:'smartthings',status:'blocked',discovered:0,reason:'ST_AUTH_BLOCKED'});
    if(tuya.configured()){
      try{
        const rows=await tuya.discover(),observations:DeviceObservation[]=rows.map(row=>{const power=supportsTuyaSwitch(row),raw=row.status?.find(item=>typeof item.value==='boolean'&&/^switch(?:_led|_[1-9]\d*)?$/.test(item.code));return {provider:'tuya',externalId:row.id,name:row.name,category:deviceCategoryFromDomain(power?'switch':'unknown',row.name),capabilities:power?['power']:[],commandCapabilities:[],state:row.online&&typeof raw?.value==='boolean'?(raw.value?'on':'off'):'unavailable',availability:row.online?'online':'offline',values:{},observedAt:row.update_time?new Date(row.update_time*1000).toISOString():null,room:null,reason:row.online?(power?null:'CAPABILITY_UNSUPPORTED'):'PROVIDER_OFFLINE'};});
        unified.sync('tuya',observations);results.push({provider:'tuya',status:'connected',discovered:rows.length,reason:null});
      }catch(e){results.push({provider:'tuya',status:'error',discovered:0,reason:e instanceof Error?e.message:'TUYA_UNAVAILABLE'});}
    }else results.push({provider:'tuya',status:'blocked',discovered:0,reason:'TUYA_AUTH_BLOCKED'});
    res.json(unified.report(results));
  });
  app.post('/api/v1/unified-devices/add',auth(true),async(req,res)=>{
    const input=z.object({provider:z.enum(['smartthings','tuya']),externalId:z.string().min(1).max(100),expectedRevision:z.number().int().positive(),sceneId:z.string().regex(/^[\w-]{1,80}$/),existingObjectId:z.string().regex(/^[\w-]{1,80}$/).optional(),position:positionSchema.optional(),name:z.string().trim().min(1).max(120).optional(),mediaId:z.string().regex(/^[\w-]{1,80}$/).optional(),confirmSamePhysicalDevice:z.literal(true)}).strict().parse(req.body);
    const home=store.home(),scene=home.scenes.find(item=>item.id===input.sceneId),selected=unified.list().find(item=>item.provider===input.provider&&item.externalId===input.externalId);
    if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    if(!scene){res.status(400).json({error:'UNKNOWN_SCENE'});return;}
    if(!selected||selected.objectId){res.status(409).json({error:selected?'DEVICE_IDENTITY_CONFLICT':'DEVICE_NOT_DISCOVERED'});return;}
    if(!selected.capabilities.includes('power')){res.status(400).json({error:'DEVICE_CAPABILITY_UNSUPPORTED'});return;}
    const existing=input.existingObjectId?home.objects.find(object=>object.id===input.existingObjectId):undefined;
    if(input.existingObjectId&&(!existing||existing.roomId!==scene.roomId||!scene.hotspots.some(hotspot=>hotspot.objectId===existing.id))){res.status(400).json({error:'DEVICE_OBJECT_NEEDS_HOTSPOT'});return;}
    if(existing?.actions.some(action=>action.type==='portal')){res.status(400).json({error:'DEVICE_PORTAL_NOT_ALLOWED'});return;}
    if(existing&&(existing.actions.some(action=>action.type==='device')||existing.provider?.status==='configured'||store.db.prepare('SELECT 1 FROM canonical_devices WHERE object_id=?').get(existing.id))){res.status(409).json({error:'DEVICE_OBJECT_ALREADY_BOUND'});return;}
    if(!existing&&!input.position){res.status(400).json({error:'DEVICE_POSITION_REQUIRED'});return;}
    if(input.mediaId&&!existsSync(path.join(options.root,'media',input.mediaId,'manifest.json'))){res.status(400).json({error:'UNKNOWN_MEDIA'});return;}
    if(input.provider==='smartthings'&&!(await smartthings.discover()).some(item=>item.deviceId===input.externalId&&supportsSwitch(item))){res.status(400).json({error:'ST_DEVICE_NOT_DISCOVERED'});return;}
    if(input.provider==='tuya'&&!(await tuya.discover()).some(item=>item.id===input.externalId&&supportsTuyaSwitch(item))){res.status(400).json({error:'TUYA_DEVICE_NOT_DISCOVERED'});return;}
    const objectId=existing?.id??randomUUID();
    const object=existing?{...existing,name:input.name??existing.name,mediaId:input.mediaId??existing.mediaId}:{id:objectId,roomId:scene.roomId,name:input.name??selected.name,description:'',category:deviceCategoryLabel[selected.category],kind:objectKindFromDeviceCategory(selected.category),visibility:'private' as const,mediaId:input.mediaId,actions:[{type:'info' as const}]};
    const candidate={...home,objects:existing?home.objects.map(item=>item.id===objectId?object:item):[...home.objects,object],scenes:existing?home.scenes:home.scenes.map(item=>item.id===scene.id?{...item,hotspots:[...item.hotspots,{id:randomUUID(),objectId,position:input.position!}]}:item)};
    const next=input.provider==='smartthings'?registry.linkSmartThings(candidate,objectId,input.externalId):registry.linkTuya(candidate,objectId,input.externalId);
    store.audit('owner','device.add',`${input.provider}:${objectId}`);res.status(201).json({home:next,objectId,controlEnabled:false});
  });
  app.get('/api/v1/smartthings',auth(true),(_req,res)=>res.json({status:smartthings.configured()?'DIAGNOSTIC_READ_ONLY':'AUTH_BLOCKED',oauthRegistration:'NOT_AVAILABLE',physicalCommands:false}));
  app.get('/api/v1/smartthings/discover',auth(true),async(_req,res)=>res.json((await smartthings.discover()).map(d=>({...d,supportedCapabilities:supportsSwitch(d)?['power']:[]}))));
  app.get('/api/v1/smartthings/bindings',auth(true),(_req,res)=>res.json(registry.smartthingsBindings()));
  app.post('/api/v1/smartthings/bind',auth(true),async(req,res)=>{
    const input=z.object({objectId:z.string().regex(/^[\w-]{1,80}$/),deviceId:z.string().uuid(),expectedRevision:z.number().int().positive(),confirmSamePhysicalDevice:z.boolean()}).strict().parse(req.body);
    if(!input.confirmSamePhysicalDevice){res.status(400).json({error:'DEVICE_CONFIRMATION_REQUIRED'});return;}
    const home=store.home();if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    const discovered=await smartthings.discover();
    const selected=discovered.find(d=>d.deviceId===input.deviceId);
    if(!selected){res.status(400).json({error:'ST_DEVICE_NOT_DISCOVERED'});return;}
    if(!supportsSwitch(selected)){res.status(400).json({error:'ST_CAPABILITY_UNSUPPORTED'});return;}
    const next=registry.linkSmartThings(home,input.objectId,input.deviceId);
    res.status(201).json(next);
  });
  app.post('/api/v1/smartthings/unbind',auth(true),(req,res)=>{
    const input=z.object({objectId:z.string().regex(/^[\w-]{1,80}$/),expectedRevision:z.number().int().positive()}).strict().parse(req.body);
    const home=store.home();if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    res.json(registry.unlinkSmartThings(home,input.objectId));
  });
  app.get('/api/v1/tuya',auth(true),(_req,res)=>res.json({status:tuya.configured()?'DIAGNOSTIC_READ_ONLY':'AUTH_BLOCKED',physicalCommands:false}));
  app.get('/api/v1/tuya/discover',auth(true),async(_req,res)=>res.json((await tuya.discover()).map(d=>({id:d.id,name:d.name,online:d.online,supportedCapabilities:supportsTuyaSwitch(d)?['power']:[]}))));
  app.get('/api/v1/tuya/bindings',auth(true),(_req,res)=>res.json(registry.tuyaBindings()));
  app.post('/api/v1/tuya/bind',auth(true),async(req,res)=>{
    const input=z.object({objectId:z.string().regex(/^[\w-]{1,80}$/),deviceId:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),expectedRevision:z.number().int().positive(),confirmSamePhysicalDevice:z.literal(true)}).strict().parse(req.body);
    const home=store.home();if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    const selected=(await tuya.discover()).find(d=>d.id===input.deviceId);
    if(!selected){res.status(400).json({error:'TUYA_DEVICE_NOT_DISCOVERED'});return;}
    if(!supportsTuyaSwitch(selected)){res.status(400).json({error:'TUYA_CAPABILITY_UNSUPPORTED'});return;}
    res.status(201).json(registry.linkTuya(home,input.objectId,input.deviceId));
  });
  app.post('/api/v1/tuya/unbind',auth(true),(req,res)=>{
    const input=z.object({objectId:z.string().regex(/^[\w-]{1,80}$/),expectedRevision:z.number().int().positive()}).strict().parse(req.body);
    const home=store.home();if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    res.json(registry.unlinkTuya(home,input.objectId));
  });
  app.get('/api/v1/ha',auth(true),(_req,res)=>res.json(ha.info()));
  app.post('/api/v1/ha/configure',auth(true),async(req,res)=>{
    const input=z.object({origin:z.string().max(300)}).strict().parse(req.body);
    try{res.json(await ha.configure(input.origin));}
    catch(e){store.audit('owner','ha.connection.failed',e instanceof Error?e.message:'HA_ERROR');throw e;}
  });
  app.post('/api/v1/ha/test',auth(true),async(_req,res)=>{
    try{res.json(await ha.test());}catch(e){store.audit('owner','ha.connection.failed',e instanceof Error?e.message:'HA_ERROR');throw e;}
  });
  app.get('/api/v1/ha/discover',auth(true),async(_req,res)=>res.json(await ha.discover()));
  app.get('/api/v1/ha/inventory',auth(true),async(_req,res)=>res.json(await ha.inventory()));
  app.get('/api/v1/ha/bindings',auth(true),(_req,res)=>res.json(store.db.prepare('SELECT binding_id AS bindingId,object_id AS objectId,entity_id AS entityId FROM ha_bindings').all()));
  app.post('/api/v1/ha/add',auth(true),async(req,res)=>{
    const input=z.object({entityId:z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/),expectedRevision:z.number().int().positive(),sceneId:z.string().regex(/^[\w-]{1,80}$/),existingObjectId:z.string().regex(/^[\w-]{1,80}$/).optional(),position:positionSchema.optional(),name:z.string().trim().min(1).max(120).optional(),mediaId:z.string().regex(/^[\w-]{1,80}$/).optional(),confirmSamePhysicalDevice:z.literal(true),enableControl:z.boolean().default(false),moveExisting:z.boolean().default(false)}).strict().parse(req.body);
    const home=store.home(),scene=home.scenes.find(s=>s.id===input.sceneId);
    if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    if(!scene){res.status(400).json({error:'UNKNOWN_SCENE'});return;}
    const existing=input.existingObjectId?home.objects.find(o=>o.id===input.existingObjectId):undefined;
    if(input.existingObjectId&&(!existing||existing.roomId!==scene.roomId||!scene.hotspots.some(h=>h.objectId===existing.id))){res.status(400).json({error:'DEVICE_OBJECT_NEEDS_HOTSPOT'});return;}
    if(existing?.actions.some(a=>a.type==='portal')){res.status(400).json({error:'DEVICE_PORTAL_NOT_ALLOWED'});return;}
    if(existing&&(existing.actions.some(a=>a.type==='device')||existing.provider?.status==='configured'||store.db.prepare('SELECT 1 FROM canonical_devices WHERE object_id=?').get(existing.id))){res.status(409).json({error:'DEVICE_OBJECT_ALREADY_BOUND'});return;}
    if(!existing&&!input.position){res.status(400).json({error:'DEVICE_POSITION_REQUIRED'});return;}
    if(input.mediaId&&!existsSync(path.join(options.root,'media',input.mediaId,'manifest.json'))){res.status(400).json({error:'UNKNOWN_MEDIA'});return;}
    const selected=(await ha.inventory()).find(e=>e.entityId===input.entityId&&e.supported);
    if(!selected){res.status(400).json({error:'HA_ENTITY_NOT_DISCOVERED'});return;}
    const old=store.db.prepare('SELECT binding_id,object_id FROM ha_bindings WHERE entity_id=?').get(input.entityId) as {binding_id:string;object_id:string}|undefined;
    if(!!old!==input.moveExisting){res.status(409).json({error:'HA_IDENTITY_CONFLICT'});return;}
    if(old){const canonical=store.db.prepare('SELECT id FROM canonical_devices WHERE object_id=?').get(old.object_id) as {id:string}|undefined;if(!canonical||store.db.prepare("SELECT 1 FROM provider_identities WHERE device_id=? AND provider!='home-assistant'").get(canonical.id)){res.status(409).json({error:'DEVICE_SECONDARY_SOURCE_BOUND'});return;}}
    if(old&&old.object_id===existing?.id){res.status(409).json({error:'DEVICE_SAME_OBJECT'});return;}
    const objectId=existing?.id??randomUUID(),bindingId=old?.binding_id??`ha-${randomUUID()}`,controlEnabled=input.enableControl&&selected.commandCapabilities.includes('power')&&selected.availability==='online';
    const next=store.db.transaction(()=>{
      if(old){store.db.prepare('UPDATE ha_bindings SET object_id=?,control_enabled=? WHERE binding_id=?').run(objectId,controlEnabled?1:0,bindingId);store.db.prepare('UPDATE canonical_devices SET object_id=? WHERE object_id=?').run(objectId,old.object_id);}
      else{store.db.prepare('INSERT INTO ha_bindings(binding_id,object_id,entity_id,control_enabled) VALUES(?,?,?,?)').run(bindingId,objectId,input.entityId,controlEnabled?1:0);const deviceId=`device-${randomUUID()}`;store.db.prepare('INSERT INTO canonical_devices(id,object_id,primary_provider) VALUES(?,?,?)').run(deviceId,objectId,'home-assistant');store.db.prepare('INSERT INTO provider_identities(provider,external_id,device_id,confirmed_by) VALUES(?,?,?,?)').run('home-assistant',input.entityId,deviceId,'owner');}
      const object=existing?{...existing,name:input.name??existing.name,mediaId:input.mediaId??existing.mediaId,kind:existing.kind??objectKindFromDeviceCategory(selected.category),provider:{identity:objectId,active:'home-assistant' as const,status:'configured' as const},actions:[...existing.actions.filter(a=>a.type!=='integration'),{type:'device' as const,bindingId}]}:{id:objectId,roomId:scene.roomId,name:input.name??selected.name,description:'',category:deviceCategoryLabel[selected.category],kind:objectKindFromDeviceCategory(selected.category),visibility:'private' as const,mediaId:input.mediaId,provider:{identity:objectId,active:'home-assistant' as const,status:'configured' as const},actions:[{type:'device' as const,bindingId}]};
      const objects=home.objects.map(o=>{if(o.id!==old?.object_id)return o;const actions=o.actions.filter(a=>!(a.type==='device'&&a.bindingId===bindingId));return {...o,provider:undefined,actions:actions.length?actions:[{type:'info' as const}]};}).map(o=>o.id===objectId?object:o);
      return store.save({...home,objects:existing?objects:[...objects,object],scenes:existing?home.scenes:home.scenes.map(s=>s.id===scene.id?{...s,hotspots:[...s.hotspots,{id:randomUUID(),objectId,position:input.position!}]}:s)},'owner');
    })();
    store.audit('owner',old?'ha.move':'ha.add',`${objectId}:${input.entityId}:${controlEnabled?'control':'read-only'}`);
    res.status(201).json({home:next,objectId,controlEnabled});
  });
  app.post('/api/v1/ha/bind',auth(true),async(req,res)=>{
    const input=z.object({objectId:z.string().regex(/^[\w-]{1,80}$/),entityId:z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/),expectedRevision:z.number().int().positive(),confirmSamePhysicalDevice:z.literal(true)}).strict().parse(req.body);
    const home=store.home(),object=home.objects.find(o=>o.id===input.objectId);
    if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    if(!object||!home.scenes.some(s=>s.hotspots.some(h=>h.objectId===object.id))){res.status(400).json({error:'HA_OBJECT_NEEDS_HOTSPOT'});return;}
    if(object.actions.some(a=>a.type==='portal')){res.status(400).json({error:'DEVICE_PORTAL_NOT_ALLOWED'});return;}
    if(store.db.prepare('SELECT 1 FROM canonical_devices WHERE object_id=?').get(object.id)){res.status(409).json({error:'DEVICE_OBJECT_ALREADY_BOUND'});return;}
    if(ha.binding(object.id)||store.db.prepare('SELECT 1 FROM ha_bindings WHERE entity_id=?').get(input.entityId)){res.status(409).json({error:'HA_IDENTITY_CONFLICT'});return;}
    const discovered=await ha.inventory();
    if(!discovered.some(e=>e.entityId===input.entityId)){res.status(400).json({error:'HA_ENTITY_NOT_DISCOVERED'});return;}
    const bindingId=`ha-${randomUUID()}`;
    const next=store.db.transaction(()=>{
      store.db.prepare('INSERT INTO ha_bindings(binding_id,object_id,entity_id) VALUES(?,?,?)').run(bindingId,object.id,input.entityId);
      const deviceId=`device-${randomUUID()}`;
      store.db.prepare('INSERT INTO canonical_devices(id,object_id,primary_provider) VALUES(?,?,?)').run(deviceId,object.id,'home-assistant');
      store.db.prepare('INSERT INTO provider_identities(provider,external_id,device_id,confirmed_by) VALUES(?,?,?,?)').run('home-assistant',input.entityId,deviceId,'owner');
      return store.save({...home,objects:home.objects.map(o=>o.id===object.id?{...o,provider:{identity:o.id,active:'home-assistant' as const,status:'configured' as const},actions:[...o.actions.filter(a=>a.type!=='device'&&!(a.type==='integration'&&a.adapterId==='home-assistant')),{type:'device' as const,bindingId}]}:o)},'owner');
    })();
    store.audit('owner','ha.bind',`${input.objectId}:${input.entityId}`);res.status(201).json(next);
  });
  app.post('/api/v1/ha/unbind',auth(true),(req,res)=>{
    const input=z.object({objectId:z.string().regex(/^[\w-]{1,80}$/),expectedRevision:z.number().int().positive()}).strict().parse(req.body);
    const home=store.home(),binding=ha.binding(input.objectId);
    if(home.revision!==input.expectedRevision)throw Error('REVISION_CONFLICT');
    if(!binding){res.status(404).json({error:'UNKNOWN_BINDING'});return;}
    const canonical=store.db.prepare('SELECT id FROM canonical_devices WHERE object_id=?').get(input.objectId) as {id:string}|undefined;
    if(canonical&&store.db.prepare("SELECT 1 FROM provider_identities WHERE device_id=? AND provider!='home-assistant'").get(canonical.id)){res.status(409).json({error:'DEVICE_SECONDARY_SOURCE_BOUND'});return;}
    const next=store.db.transaction(()=>{
      store.db.prepare('DELETE FROM ha_bindings WHERE object_id=?').run(input.objectId);
      store.db.prepare('DELETE FROM canonical_devices WHERE object_id=?').run(input.objectId);
      return store.save({...home,objects:home.objects.map(o=>{
        if(o.id!==input.objectId)return o;
        const actions=o.actions.filter(a=>!(a.type==='device'&&a.bindingId===binding.binding_id)&&!(a.type==='integration'&&a.adapterId==='home-assistant'));
        return {...o,provider:undefined,actions:actions.length?actions:[{type:'info' as const}]};
      })},'owner');
    })();
    store.audit('owner','ha.unbind',`${input.objectId}:${binding.entity_id}`);res.json(next);
  });
  app.post('/api/v1/uploads',auth(true),express.raw({type:'application/octet-stream',limit:'30mb'}),async(req,res)=>{
    const kind=z.enum(['photo','video']).parse(req.query.kind);
    if(!Buffer.isBuffer(req.body)||!req.body.length){res.status(400).json({error:'INVALID_MEDIA'});return;}
    const imported=await importObjectMedia(req.body,options.root,kind);
    store.audit('owner','media.import',imported.id);res.status(201).json(imported);
  });
  app.post('/api/v1/document-uploads',auth(true),express.raw({type:'application/octet-stream',limit:'10mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!req.body.length){res.status(400).json({error:'INVALID_DOCUMENT'});return;}
    const imported=await importDocument(req.body,options.root);store.audit('owner','document.import',imported.id);res.status(201).json(imported);
  });
  const mediaIds = () =>
    existsSync(path.join(options.root, "media"))
      ? readdirSync(path.join(options.root, "media")).filter(
          (id) =>
            /^[\w-]+$/.test(id) &&
            existsSync(path.join(options.root, "media", id, "manifest.json")),
        )
      : [];
  app.post('/api/v1/bindings/edit', auth(true), (req, res) => {
    res.json(editBinding(store, bindingEditSchema.parse(req.body), (res.locals.user as Identity).id));
  });
  app.get("/api/v1/home", privateAuth, (_req, res) => res.json(permittedHome(res.locals.user as Identity)));
  const validateHomeEdit = (body: unknown, res: Response): Home | undefined => {
    const next = homeSchema.parse(body),
      ids = mediaIds();
    if(next.revision!==store.home().revision)throw Error('REVISION_CONFLICT');
    if (next.id !== store.home().id || next.demo !== store.home().demo) {
      res.status(400).json({ error: "HOME_IDENTITY_IMMUTABLE" });
      return;
    }
    for(const o of next.objects){
      if(o.photoSuggestionId&&store.home().objects.find(old=>old.id===o.id)?.photoSuggestionId!==o.photoSuggestionId){
        const proposal=store.db.prepare('SELECT confirmed_json,source_revision FROM photo_suggestions WHERE id=?').get(o.photoSuggestionId) as {confirmed_json:string|null;source_revision:number}|undefined;
        if(!proposal?.confirmed_json){res.status(400).json({error:'AI_CONFIRMATION_REQUIRED'});return;}
        if(proposal.source_revision!==next.revision)throw Error('REVISION_CONFLICT');
      }
    }
    if (
      next.scenes.some((s) => !ids.includes(s.mediaId)) ||
      next.objects.some((o) => allObjectMediaIds(o).some(id=>!ids.includes(id)))
    ) {
      res.status(400).json({ error: "UNKNOWN_MEDIA" });
      return;
    }
    const manifestKind=(id:string)=>JSON.parse(readFileSync(path.join(options.root,'media',id,'manifest.json'),'utf8')).kind??'panorama';
    const invalidExperienceMedia=(o:ReturnType<typeof homeSchema.parse>['objects'][number])=>[o,o.experiences?.private,o.experiences?.showroom].filter(Boolean).some(profile=>
      (profile!.mediaId&&!['photo','panorama'].includes(manifestKind(profile!.mediaId))) || (profile!.gallery??[]).some(id=>!['photo','panorama'].includes(manifestKind(id))) || (profile!.videoId&&manifestKind(profile!.videoId)!=='video'));
    if(next.scenes.some(s=>manifestKind(s.mediaId)!=='panorama') || next.objects.some(o=>
      (o.mediaType==='video') || invalidExperienceMedia(o) || (o.documents??[]).some(d=>manifestKind(d.mediaId)!=='document'||JSON.parse(readFileSync(path.join(options.root,'media',d.mediaId,'manifest.json'),'utf8')).mime!==d.mime))) {
      res.status(400).json({error:'INVALID_MEDIA_KIND'});return;
    }
    store.validateBindings(next);
    return next;
  };
  app.post("/api/v1/home/validate", auth(true), (req, res) => {
    const next = validateHomeEdit(req.body, res);
    if(next) res.json(next);
  });
  app.put("/api/v1/home", auth(true), (req, res) => {
    const next = validateHomeEdit(req.body, res);
    if(next) res.json(store.save(next, (res.locals.user as Identity).id));
  });
  app.get("/api/v1/revisions", auth(true), (_req, res) =>
    res.json(
      store.db
        .prepare(
          "SELECT revision,created_at FROM revisions ORDER BY revision DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.post("/api/v1/restore", auth(true), (req, res) => {
    const input = z
      .object({
        revision: z.number().int().positive(),
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    const row = store.db
      .prepare("SELECT document FROM revisions WHERE revision=?")
      .get(input.revision) as { document: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "REVISION_NOT_FOUND" });
      return;
    }
    res.json(
      store.save(
        {
          ...homeSchema.parse(JSON.parse(row.document)),
          revision: input.expectedRevision,
        },
        (res.locals.user as Identity).id,
      ),
    );
  });
  app.get("/api/v1/media", privateAuth, (_req, res) => res.json((res.locals.user as Identity).role==='owner'?mediaIds():[...permittedMedia(res.locals.user as Identity)]));
  app.get("/api/v1/media/:id/manifest", privateAuth, (req, res) => {
    if((res.locals.user as Identity).role!=='owner'&&!permittedMedia(res.locals.user as Identity).has(String(req.params.id))){res.status(403).end();return;}
    if (!mediaIds().includes(String(req.params.id))) {
      res.status(404).end();
      return;
    }
    res.json(
      JSON.parse(
        readFileSync(
          path.join(
            options.root,
            "media",
            String(req.params.id),
            "manifest.json",
          ),
          "utf8",
        ),
      ),
    );
  });
  app.get("/api/v1/media/:id/:file", privateAuth, (req, res) => {
    if((res.locals.user as Identity).role!=='owner'&&!permittedMedia(res.locals.user as Identity).has(String(req.params.id))){res.status(403).end();return;}
    if (
      !mediaIds().includes(String(req.params.id)) ||
      !/^(preview\.jpg|video\.mp4|document\.(pdf|txt)|\d+-\d+-\d+\.jpg)$/.test(String(req.params.file))
    ) {
      res.status(404).end();
      return;
    }
    const file = path.resolve(
      options.root,
      "media",
      String(req.params.id),
      String(req.params.file),
    );
    if (!existsSync(file)) {
      res.status(404).end();
      return;
    }
    res.set("Cache-Control", "private, no-cache");
    if(/^document\./.test(String(req.params.file))){const m=JSON.parse(readFileSync(path.join(options.root,'media',String(req.params.id),'manifest.json'),'utf8'));res.set(documentDownloadHeaders(m.mime));}
    res.sendFile(file, { dotfiles: "allow" });
  });
  app.get("/api/v1/devices", privateAuth, async (_req, res) => {
    res.json(await deviceSnapshotFor(res.locals.user as Identity));
  });
  app.get("/api/v1/integrations", privateAuth, (_req, res) =>
    res.json(integrationCatalog),
  );
  app.post("/api/v1/commands",privateAuth,async(req,res)=>{
    if(!['owner','household'].includes(res.locals.user.role)){store.audit(res.locals.user.id,'command.denied','OWNER_REQUIRED');throw new ActionError(403,'OWNER_REQUIRED');}
    // Old F1 AI clients sent proposals through /commands. Require the current
    // manual-button protocol so an old tab cannot bypass the new AI policy.
    if(req.get('X-RediOnHome-Command-Protocol')!=='2')throw new ActionError(426,'ACTION_CLIENT_UPDATE_REQUIRED');
    const {requestId=randomUUID(),...command}=manualCommandSchema.parse(req.body);
    const run=await actions.prepare(res.locals.user,res.locals.sessionHash,{requestId,source:'manual',channel:'button',steps:[command]});
    const result=await actions.execute(run.id,res.locals.user,res.locals.sessionHash,true);
    if(result.status!=='succeeded')throw new ActionError(409,'ACTION_NOT_CONFIRMED');
    res.set('X-Action-Run-Id',run.id).json(await deviceSnapshotFor(res.locals.user));
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if(error instanceof ActionError){res.status(error.status).json({error:error.message});return;}
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "INVALID_INPUT" });
      return;
    }
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({
          error: "INVALID_INPUT",
          details: error.issues.slice(0, 12).map((issue) => ({
            path: issue.path.map(String).join("."),
          })),
        });
      return;
    }
    if (error instanceof Error && ['INVALID_SELECTION','UNSAFE_EXPORT_TEXT','INVALID_MEDIA','INVALID_DOCUMENT'].includes(error.message)) {
      res.status(400).json({error:error.message});return;
    }
    if (error instanceof Error && error.message === "REVISION_CONFLICT") {
      res.status(409).json({ error: "REVISION_CONFLICT" });
      return;
    }
    if(error instanceof Error&&error.message==='UNKNOWN_BINDING'){res.status(404).json({error:error.message});return;}
    if(error instanceof Error&&error.message==='DEVICE_OBJECT_NEEDS_HOTSPOT'){res.status(400).json({error:error.message});return;}
    if(error instanceof Error&&['DEVICE_IDENTITY_CONFLICT','DEVICE_OBJECT_ALREADY_BOUND','EXTERNAL_BINDING_MANAGED'].includes(error.message)){res.status(409).json({error:error.message});return;}
    if(error instanceof Error&&error.message.startsWith('ST_')){res.status(error.message==='ST_AUTH_REQUIRED'?401:error.message==='ST_AUTH_BLOCKED'||error.message==='ST_TOKEN_FILE_UNSAFE'?503:502).json({error:error.message});return;}
    if(error instanceof Error&&error.message.startsWith('TUYA_')){res.status(error.message==='TUYA_AUTH_REQUIRED'?401:error.message==='TUYA_AUTH_BLOCKED'||error.message==='TUYA_CONFIG_UNSAFE'?503:502).json({error:error.message});return;}
    if(error instanceof Error&&error.message==='HA_BINDING_MANAGED'){res.status(409).json({error:'HA_BINDING_MANAGED'});return;}
    if(error instanceof Error&&error.message==='DEVICE_UNAVAILABLE'){res.status(409).json({error:'DEVICE_UNAVAILABLE'});return;}
    if(error instanceof Error&&error.message.startsWith('HA_')){
      const code=error.message;
      const status=code==='HA_AUTH_FAILED'?401:code==='HA_DUPLICATE_PROVIDER'||code==='HA_STATE_NOT_CONFIRMED'?409:code==='HA_ORIGIN_INVALID'||code==='HA_ORIGIN_NOT_ALLOWED'?400:503;
      res.status(status).json({error:code});return;
    }
    if((error as {type?:string}).type==='entity.too.large'){res.status(413).json({error:'MEDIA_TOO_LARGE'});return;}
    res.status(500).json({ error: "REQUEST_FAILED" });
  };
  app.use(errors);
  if(ha.info().configured)ha.connect();
  return { app, store, ha, actions };
}

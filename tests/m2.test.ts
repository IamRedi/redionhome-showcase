import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import { createApp } from '../server/app.ts';
import { privateLinkSchema, safeAppLinkSchema, safeLinkSchema } from '../shared/model.ts';
import { resolveObjectExperience } from '../shared/experience.ts';
import { importObjectMedia } from '../server/object-media.ts';
import {exportPublication} from '../server/export.ts';
import {createShowroomApp} from '../server/showroom.ts';
import { ProviderRegistry } from '../server/provider-registry.ts';
import type { UniversalProvider } from '../shared/providers.ts';
const origin = 'http://127.0.0.1:4191', password = 'synthetic-owner-password-42';
let root: string, service: ReturnType<typeof createApp>, owner: string;
const get = (url: string, cookie?: string) => request(service.app).get(`/api/v1${url}`).set('Host', '127.0.0.1:4191').set('Cookie', cookie ?? '');
const post = (url: string, body: unknown, cookie = owner) => request(service.app).post(`/api/v1${url}`).set('Host', '127.0.0.1:4191').set('Origin', origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie', cookie).send(body as object);
beforeEach(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'redionhome-m2-'));
    service = createApp({ root, origin, password, production: true });
    const photo = await sharp({ create: { width: 512, height: 256, channels: 3, background: '#527951' } }).withExif({ IFD0: { Copyright: 'PRIVATE EXIF SENTINEL' } }).jpeg().toBuffer();
    for (const id of ['atelier', 'studio', 'private-photo']) {
        const dir = path.join(root, 'media', id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'preview.jpg'), photo);
        writeFileSync(path.join(dir, '0-0-0.jpg'), photo);
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id, width: 2048, height: 1024, levels: [{ width: 2048, cols: 4, rows: 2 }], sha256: 'PRIVATE-HASH' }));
        writeFileSync(path.join(dir, 'original'), 'ORIGINAL-PRIVATE-SENTINEL');
    }
    const login = await post('/login', { password }, '');
    owner = login.headers['set-cookie'][0].split(';')[0];
    const home = service.store.home();
    for (const scene of home.scenes)
        scene.visibility = 'public';
    for (const o of home.objects) {
        o.visibility = 'public';
        o.permissions = { householdView: true, householdControl: true };
    }
    home.objects.find(o => o.id === 'artwork')!.actions.push({ type: 'demo', demo: 'led-wall' });
    service.store.save(home, 'test');
});
afterEach(() => { service.store.close(); rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
async function draft(audience: 'invited' | 'public' = 'invited', objectIds = ['artwork', 'light', 'to-studio']) {
    const response = await post('/publications', { title: 'Safe showroom', audience, sceneIds: ['atelier-view'], objectIds, mediaIds: ['atelier'], expectedRevision: service.store.home().revision });
    expect(response.status).toBe(201);
    return response.body.id as string;
}
async function activate(id: string) { expect((await post(`/publications/${id}/activate`, { approved: true })).status).toBe(200); }
async function invite(id: string, maxSessions = 1) { const r = await post('/invitations', { label: 'Guest', role: 'invited_guest', expiresHours: 1, maxSessions, grant: { publicationId: id } }); expect(r.status).toBe(201); return r.body as {
    id: string;
    token: string;
}; }
async function redeem(token: string) { const r = await post('/invitations/redeem', { token }, ''); expect(r.status).toBe(200); return r.headers['set-cookie'][0].split(';')[0] as string; }
it('tour draft is private, explicit approval activates only the selected audience', async () => {
    const id = await draft('public');
    expect((await get(`/tours/${id}/home`)).status).toBe(403);
    expect((await get(`/tours/${id}/home`, owner)).status).toBe(200);
    expect((await post(`/publications/${id}/activate`, {})).status).toBe(400);
    await activate(id);
    expect((await get(`/tours/${id}/home`)).status).toBe(200);
    await post('/publications/disable', { audience: 'public' });
    expect((await get(`/tours/${id}/home`)).status).toBe(403);
});
it('guest gets a safe snapshot, no hidden objects, bindings, provider identities, hashes or external destinations', async () => {
    const h = service.store.home();
    h.objects.find(o => o.id === 'artwork')!.provider = { identity: 'PRIVATE-DEVICE', active: 'piano-core', status: 'planned' };
    service.store.save(h, 'test');
    const id = await draft();
    await activate(id);
    const access = await invite(id), cookie = await redeem(access.token);
    const response = await get(`/tours/${id}/home`, cookie);
    expect(response.status).toBe(200);
    const text = JSON.stringify(response.body);
    for (const secret of ['PRIVATE-DEVICE', 'bindingId', 'demo-light', '"mediaId":"atelier"', '"sceneId":"studio-view"', 'provider', 'permissions', 'PRIVATE-HASH'])
        expect(text).not.toContain(secret);
    expect(response.body.scenes).toHaveLength(1);
    expect(response.body.objects).toHaveLength(3);
    expect(response.body.objects.flatMap((o: {
        actions: {
            type: string;
        }[];
    }) => o.actions).every((a: {
        type: string;
    }) => ['info', 'demo', 'link'].includes(a.type))).toBe(true);
});
it('one object resolves private and showroom profiles while publication exports only the safe showroom contract', async () => {
    const home = service.store.home();
    const workstation = home.objects.find(object => object.id === 'workstation')!;
    workstation.experiences!.private!.actions!.push({ type: 'device', bindingId: 'private-workstation' });
    service.store.save(home, 'test');
    const current = service.store.home();
    const source = current.objects.find(object => object.id === 'workstation')!;
    expect(resolveObjectExperience(source, 'private').name).toBe('Workstation · Private Home');
    expect(resolveObjectExperience(source, 'showroom').name).toBe('Creative Workstation');
    expect(source.id).toBe('workstation');
    const created = await post('/publications', { title: 'Workstation showroom', audience: 'public', sceneIds: ['studio-view'], objectIds: ['workstation'], mediaIds: ['studio'], expectedRevision: current.revision });
    expect(created.status).toBe(201);
    const snapshot = (await get(`/tours/${created.body.id}/home`, owner)).body;
    const published = snapshot.objects[0];
    expect(published.name).toBe('Creative Workstation');
    expect(published.description).not.toBe(source.experiences!.private!.description);
    expect(published.experiences).toBeUndefined();
    expect(published.actions.map((action:{type:string}) => action.type)).toEqual(['info', 'link', 'app']);
    expect(published.showcase).toHaveLength(9);
    expect(published.showcase.map((card:{brand:string}) => card.brand)).toContain('piano');
    expect(published.showcase.map((card:{action:{type:string}}) => card.action.type)).not.toContain('device');
    expect(JSON.stringify(published)).not.toContain('Paneli privat');
    expect(JSON.stringify(published)).not.toContain('Portfolio privat');
    expect(JSON.stringify(published)).not.toContain('private-workstation');
    expect(service.store.home().objects.find(object => object.id === 'workstation')!.experiences!.private!.title).toBe('Workstation · Private Home');
});
it('the same object can be reused in two scenes without duplicating its source identity', async () => {
    const home = service.store.home();
    const sceneIds = ['studio-view', 'studio-showroom-view'];
    expect(sceneIds.every(sceneId => home.scenes.find(scene => scene.id === sceneId)!.hotspots.some(hotspot => hotspot.objectId === 'workstation'))).toBe(true);
    const created = await post('/publications', { title: 'Reusable workstation', audience: 'public', sceneIds, objectIds: ['workstation'], mediaIds: ['studio'], expectedRevision: home.revision });
    expect(created.status).toBe(201);
    const snapshot = (await get(`/tours/${created.body.id}/home`, owner)).body;
    expect(snapshot.objects).toHaveLength(1);
    expect(snapshot.scenes).toHaveLength(2);
    expect(snapshot.scenes.map((scene:{hotspots:{objectId:string}[]}) => scene.hotspots[0].objectId)).toEqual([snapshot.objects[0].id, snapshot.objects[0].id]);
});
it('legacy objects use their existing fields in both profiles without migration', () => {
    const legacy = service.store.home().objects.find(object => object.id === 'artwork')!;
    expect(legacy.experiences).toBeUndefined();
    expect(resolveObjectExperience(legacy, 'private').name).toBe(legacy.name);
    expect(resolveObjectExperience(legacy, 'showroom').actions).toEqual(legacy.actions);
});
it('manipulated guest requests cannot reach private runtime, physical/mock commands, uploads or owner operations', async () => {
    const id = await draft();
    await activate(id);
    const cookie = await redeem((await invite(id)).token);
    for (const route of ['/home', '/devices', '/integrations', '/providers', '/media', '/media/atelier/preview.jpg', '/media/private-photo/manifest', '/revisions', '/access', '/publications'])
        expect((await get(route, cookie)).status).toBe(403);
    const command = vi.fn();
    const prototype = await import('../server/adapters.ts');
    vi.spyOn(prototype.MockAdapter.prototype, 'command').mockImplementation(command);
    for (const route of ['/commands', '/restore', '/publications', '/invitations', '/uploads'])
        expect((await post(route, { objectId: 'light', action: 'turn_on', role: 'owner' }, cookie)).status).toBe(403);
    expect(command).not.toHaveBeenCalled();
});
it('tour media uses separate sanitized bytes and cannot resolve original/private paths', async () => {
    const id = await draft('public', ['artwork']);
    await activate(id);
    const h = (await get(`/tours/${id}/home`)).body, m = h.scenes[0].mediaId;
    const media = await get(`/tours/${id}/media/${m}/preview.jpg`);
    expect(media.status).toBe(200);
    expect((await sharp(media.body).metadata()).exif).toBeUndefined();
    const manifest = await get(`/tours/${id}/media/${m}/manifest`);
    expect(JSON.stringify(manifest.body)).not.toContain('sha256');
    for (const url of [`/tours/${id}/media/atelier/preview.jpg`, `/tours/${id}/media/${m}/original`, `/tours/${id}/media/${m}/manifest.json`, '/media/atelier/preview.jpg'])
        expect((await get(url)).status).not.toBe(200);
    expect(readFileSync(path.join(root, 'media', 'atelier', 'original'), 'utf8')).toBe('ORIGINAL-PRIVATE-SENTINEL');
});
it('invitations expire, revoke immediately and enforce active session limit without leaking tokens', async () => {
    const id = await draft();
    await activate(id);
    const a = await invite(id);
    const cookie = await redeem(a.token);
    expect((await post('/invitations/redeem', { token: a.token }, '')).status).toBe(409);
    const access = await get('/access', owner);
    expect(JSON.stringify(access.body)).not.toContain(a.token);
    expect(JSON.stringify(service.store.db.prepare('SELECT * FROM invitations').all())).not.toContain(a.token);
    await post(`/access/${a.id}/revoke`, {});
    expect((await get(`/tours/${id}/home`, cookie)).status).toBe(403);
    expect((await post('/invitations/redeem', { token: a.token }, '')).status).toBe(401);
    const b = await invite(id);
    const cookieB = await redeem(b.token);
    service.store.db.prepare('UPDATE access SET expires=0 WHERE user_id=?').run(b.id);
    expect((await get(`/tours/${id}/home`, cookieB)).status).toBe(403);
    expect((await post('/invitations/redeem', { token: b.token }, '')).status).toBe(401);
});
it('guest publication scope cannot be changed by request headers or guessed IDs', async () => {
    const first = await draft();
    await activate(first);
    const cookie = await redeem((await invite(first)).token);
    const second = await draft();
    expect((await get(`/tours/${second}/home`, cookie).set('X-Role', 'owner')).status).toBe(403);
    await activate(second);
    expect((await get(`/tours/${first}/home`, cookie)).status).toBe(403);
});
it('private edits do not mutate snapshots; explicit rollback reactivates original content', async () => {
    const first = await draft('public');
    await activate(first);
    const before = (await get(`/tours/${first}/home`)).body;
    const h = service.store.home();
    h.objects.find(o => o.id === 'artwork')!.description = 'Changed private';
    service.store.save(h, 'test');
    expect((await get(`/tours/${first}/home`)).body).toEqual(before);
    const second = await draft('public');
    await activate(second);
    expect((await get(`/tours/${first}/home`)).status).toBe(403);
    await activate(first);
    expect((await get(`/tours/${first}/home`)).body).toEqual(before);
});
it('rejects private scene/object selection, omitted panorama media, stale revisions and recognizable sensitive text', async () => {
    const h = service.store.home();
    h.scenes[0].visibility = 'private';
    service.store.save(h, 'test');
    const selection = { title: 'Safe', audience: 'public', sceneIds: ['atelier-view'], objectIds: [], mediaIds: ['atelier'], expectedRevision: service.store.home().revision };
    expect((await post('/publications', selection)).status).toBe(400);
    const next = service.store.home();
    next.scenes[0].visibility = 'public';
    next.scenes[0].name = '127.0.0.1';
    service.store.save(next, 'test');
    selection.expectedRevision = next.revision + 1;
    expect((await post('/publications', selection)).body.error).toBe('UNSAFE_EXPORT_TEXT');
    next.scenes[0].name = 'Safe';
    next.revision = service.store.home().revision;
    service.store.save(next, 'test');
    selection.expectedRevision = service.store.home().revision;
    expect((await post('/publications', { ...selection, mediaIds: [] })).status).toBe(400);
    expect((await post('/publications', { ...selection, expectedRevision: 1 })).status).toBe(409);
    next.revision = service.store.home().revision;
    next.objects[0].visibility = 'private';
    service.store.save(next, 'test');
    expect((await post('/publications', { ...selection, expectedRevision: service.store.home().revision, objectIds: ['artwork'] })).status).toBe(400);
});
it('household has only granted scene/object/media/state and explicit mock commands', async () => {
    const response = await post('/invitations', { label: 'Family', role: 'household', expiresHours: 1, maxSessions: 2, grant: { sceneIds: ['atelier-view'], objectIds: ['light'], commandObjectIds: ['light'] } });
    expect(response.status).toBe(201);
    const cookie = await redeem(response.body.token);
    const h = (await get('/home', cookie)).body;
    expect(h.scenes.map((s: {
        id: string;
    }) => s.id)).toEqual(['atelier-view']);
    expect(h.objects.map((o: {
        id: string;
    }) => o.id)).toEqual(['light']);
    expect((await get('/media/studio/preview.jpg', cookie)).status).toBe(403);
    expect((await get('/media/private-photo/preview.jpg', cookie)).status).toBe(403);
    expect((await post('/commands', { objectId: 'light', action: 'turn_on' }, cookie)).status).toBe(200);
    const next = service.store.home();
    next.objects.find(o => o.id === 'light')!.permissions!.householdControl = false;
    service.store.save(next, 'test');
    expect((await post('/commands', { objectId: 'light', action: 'turn_off' }, cookie)).status).toBe(403);
    expect((await post('/restore', { revision: 1, expectedRevision: 3 }, cookie)).status).toBe(403);
});
it('household no-command grants cannot be escalated and provider physical writes remain locked', async () => {
    const response = await post('/invitations', { label: 'Family', role: 'household', expiresHours: 1, maxSessions: 1, grant: { sceneIds: ['atelier-view'], objectIds: ['light'], commandObjectIds: [] } });
    const cookie = await redeem(response.body.token);
    expect((await post('/commands', { objectId: 'light', action: 'turn_on' }, cookie)).status).toBe(403);
    expect((await post('/invitations', { label: 'Bad', role: 'invited_guest', expiresHours: 1, maxSessions: 1, grant: { sceneIds: ['atelier-view'] } })).status).toBe(400);
});
it('hierarchical publication preserves remapped parents and rejects orphan selections', async () => {
    const selection={title:'Shelf tour',audience:'public' as const,sceneIds:['atelier-view'],objectIds:['shelf','drawer','tools','pliers'],mediaIds:['atelier','studio'],expectedRevision:service.store.home().revision};
    expect((await post('/publications',{...selection,objectIds:['drawer']})).status).toBe(400);
    const created=await post('/publications',selection);
    expect(created.status).toBe(201);
    const snapshot=(await get(`/tours/${created.body.id}/home`,owner)).body;
    const shelf=snapshot.objects.find((object:{name:string})=>object.name==='Rafti i veglave');
    const drawer=snapshot.objects.find((object:{name:string})=>object.name==='Sirtari i punës');
    const tools=snapshot.objects.find((object:{name:string})=>object.name==='Veglat');
    expect(drawer.parentId).toBe(shelf.id);
    expect(tools.parentId).toBe(drawer.id);
    expect(drawer.detailPosition).toEqual({x:57,y:61});
    expect(snapshot.scenes[0].hotspots).toHaveLength(1);
    expect(snapshot.scenes[0].hotspots[0].objectId).toBe(shelf.id);
});
it('household hierarchy requires the complete permitted ancestor chain', async () => {
    const bad=await post('/invitations',{label:'Orphan',role:'household',expiresHours:1,maxSessions:1,grant:{sceneIds:['atelier-view'],objectIds:['drawer'],commandObjectIds:[]}});
    expect(bad.status).toBe(400);
    const good=await post('/invitations',{label:'Shelf family',role:'household',expiresHours:1,maxSessions:1,grant:{sceneIds:['atelier-view'],objectIds:['shelf','drawer','tools','pliers'],commandObjectIds:[]}});
    expect(good.status).toBe(201);
    const cookie=await redeem(good.body.token);
    const ids=(await get('/home',cookie)).body.objects.map((object:{id:string})=>object.id);
    expect(ids).toEqual(['shelf','drawer','tools','pliers']);
});
it('object model fields and original revisions survive edit/restore/restart', async () => {
    const h = service.store.home();
    h.objects[0] = { ...h.objects[0], category: 'Product', gallery: ['atelier'], documentation: 'Text', specifications: [{ label: 'Material', value: 'Wood' }], capabilities: ['gallery', 'virtual-demo'], provider: { identity: 'stable-device', active: 'mock', status: 'mock' } };
    const saved = service.store.save(h, 'test');
    expect(saved.objects[0].gallery).toEqual(['atelier']);
    await post('/restore', { revision: 1, expectedRevision: saved.revision });
    expect(service.store.home().objects[0].category).toBeUndefined();
    const restored = await post('/restore', { revision: saved.revision, expectedRevision: saved.revision + 1 });
    expect(restored.body.objects[0].provider.identity).toBe('stable-device');
    service.store.close();
    service = createApp({ root, origin, password });
    expect(service.store.home().objects[0].specifications![0].value).toBe('Wood');
});
it('photo upload preserves source privately and exposes only metadata-free derivative', async () => {
    const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: 'red' } }).withExif({ IFD0: { Copyright: 'PRIVATE EXIF' } }).jpeg().toBuffer();
    const upload = await request(service.app).post('/api/v1/uploads?kind=photo').set('Host', '127.0.0.1:4191').set('Origin', origin).set('X-RediOnHome-Command-Protocol','2').set('Cookie', owner).set('Content-Type', 'application/octet-stream').send(bytes);
    expect(upload.status).toBe(201);
    expect(readFileSync(path.join(root, 'media', upload.body.id, 'original'))).toEqual(bytes);
    expect((await sharp((await get(`/media/${upload.body.id}/preview.jpg`, owner)).body).metadata()).exif).toBeUndefined();
    expect((await get(`/media/${upload.body.id}/preview.jpg`)).status).toBe(401);
    await expect(importObjectMedia(Buffer.from('not an mp4'), root, 'video')).rejects.toThrow();
});
it('public links cannot contain local/network origins or credentials, but ordinary query strings are allowed', () => {
    for (const link of ['http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://192.168.1.1', 'https://home.local', 'https://u:p@example.com', 'javascript:alert(1)', 'https://[::1]'])
        expect(safeLinkSchema.safeParse(link).success).toBe(false);
    for (const link of ['https://example.com/product', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n?si=share', 'https://example.com/docs#section', 'https://demo.example.com:8443/page'])
        expect(safeLinkSchema.safeParse(link).success).toBe(true);
});
it('private profile links accept local hosts, ports and query strings but never credentials', () => {
    for (const link of ['http://127.0.0.1:8123', 'https://home.local:8123/lovelace?view=1', 'https://redion.tail-net.ts.net/?x=1#room', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
        expect(privateLinkSchema.safeParse(link).success).toBe(true);
    for (const link of ['ftp://example.com', 'https://u:p@example.com', 'https://exa mple.com', 'not a url'])
        expect(privateLinkSchema.safeParse(link).success).toBe(false);
});
it('deep links are allowlisted and require a separately validated public HTTPS fallback', () => {
    expect(safeAppLinkSchema.safeParse('spotify:album:verified').success).toBe(true);
    expect(safeAppLinkSchema.safeParse('spotify:playlist:37i9dQZF1DX4dyzvuaRJ0n?si=share').success).toBe(true);
    for (const link of ['javascript:alert(1)', 'file:///etc/passwd', 'custom:private', 'spotify://user:password@example.com/item'])
        expect(safeAppLinkSchema.safeParse(link).success).toBe(false);
    expect(safeLinkSchema.safeParse('https://open.spotify.com').success).toBe(true);
    expect(safeLinkSchema.safeParse('http://open.spotify.com').success).toBe(false);
});
it('provider registry enforces active identity, authorization, availability and concurrency before actions', async () => {
    const action = vi.fn(), audit = vi.fn(), registry = new ProviderRegistry(audit);
    let release: () => void = () => { };
    const blocked = new Promise<void>(r => { release = r; });
    action.mockImplementation(() => blocked);
    const mock: UniversalProvider = { id: 'mock', kind: 'mock', discover: async () => [], state: async () => ({ identity: 'lamp', availability: 'online', values: {}, observedAt: 0 }), availability: async () => 'online', authenticate: async () => true, reconnect: async () => { }, action };
    registry.register(mock);
    registry.register({ ...mock, id: 'mqtt', kind: 'physical' });
    registry.select({ identity: 'lamp', provider: 'mock', binding: 'x', capabilities: ['power'] });
    await expect(registry.action('lamp', 'mock', 'power', true, false)).rejects.toThrow('ACTION_NOT_ALLOWED');
    await expect(registry.action('lamp', 'mqtt', 'power', true, true)).rejects.toThrow('INACTIVE_PROVIDER');
    const pending = registry.action('lamp', 'mock', 'power', true, true);
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await expect(registry.action('lamp', 'mock', 'power', true, true)).rejects.toThrow('DEVICE_BUSY');
    expect(() => registry.select({ identity: 'lamp', provider: 'mqtt', binding: 'x', capabilities: ['power'] })).toThrow('DEVICE_BUSY');
    release();
    await pending;
    registry.select({ identity: 'lamp', provider: 'mqtt', binding: 'x', capabilities: ['power'] });
    await expect(registry.action('lamp', 'mqtt', 'power', true, true)).rejects.toThrow('PHYSICAL_COMMANDS_LOCKED');
    expect(action).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
});

it('MP4 media is transcoded locally, removes metadata, exports only selected sanitized video',async()=>{
 const source=path.join(root,'synthetic.mp4');
 execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=green:s=64x64:d=0.5','-metadata','comment=PRIVATE-METADATA','-c:v','libx264','-pix_fmt','yuv420p',source]);
 const bytes=readFileSync(source),media=await importObjectMedia(bytes,root,'video');
 expect(readFileSync(path.join(root,'media',media.id,'original'))).toEqual(bytes);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-of','json',path.join(root,'media',media.id,'video.mp4')],{encoding:'utf8'}));
 expect(JSON.stringify(probe)).not.toContain('PRIVATE-METADATA');
 const h=service.store.home();h.objects[0].videoId=media.id;service.store.save(h,'test');
 const draftResponse=await post('/publications',{title:'Video',audience:'public',sceneIds:['atelier-view'],objectIds:['artwork'],mediaIds:['atelier',media.id],expectedRevision:service.store.home().revision});
 expect(draftResponse.status).toBe(201);await activate(draftResponse.body.id);
 const snapshot=(await get(`/tours/${draftResponse.body.id}/home`)).body;
 expect((await get(`/tours/${draftResponse.body.id}/media/${snapshot.objects[0].videoId}/video.mp4`)).status).toBe(200);
});

it('independent approved artifact has no runtime database, credentials, private media or command routes',async()=>{
 const id=await draft('public',['artwork']);const target=path.join(root,'isolated-export'),client=path.join(root,'synthetic-client');
 mkdirSync(client);writeFileSync(path.join(client,'index.html'),'<html>Showroom</html>');
 expect(()=>exportPublication(root,id,target,client)).toThrow('Only owner-approved');await activate(id);exportPublication(root,id,target,client);
 const app=createShowroomApp(target,'http://127.0.0.1:4192');
 expect((await request(app).get(`/api/v1/tours/${id}/home`).set('Host','127.0.0.1:4192')).status).toBe(200);
 for(const route of ['/api/v1/home','/api/v1/devices','/api/v1/media/atelier/preview.jpg','/.data/home.sqlite'])expect((await request(app).get(route).set('Host','127.0.0.1:4192')).status).toBe(404);
 expect((await request(app).post('/api/v1/commands').set('Host','127.0.0.1:4192').send({objectId:'light',action:'turn_on'})).status).toBe(405);
 expect(readFileSync(path.join(target,'tour','home.json'),'utf8')).not.toContain('bindingId');
});

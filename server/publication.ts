import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { homeSchema, type Home, type HomeObject } from '../shared/model.ts';
import type { Selection } from '../shared/access.ts';
import { ancestorIds, rootHasHotspot } from '../shared/hierarchy.ts';
import { resolveObjectExperience } from '../shared/experience.ts';
// Reject recognizable local addresses/secrets in owner-authored text too. Manual
// preview remains necessary for sensitive content visible inside an image/video.
export function safeText(value: string): string {
    if (Array.from(value).some(c=>c.charCodeAt(0)<9) || /(?:\b(?:fe80|fd[0-9a-f]{2}|fc[0-9a-f]{2}):|::1\b|\.(?:internal|lan|home)\b)/i.test(value) || /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3})\b|https?:\/\/|\b(?:bearer|token|password|credential|secret)\s*[:=]|(?:\/home\/|\.local\b)/i.test(value))
        throw Error('UNSAFE_EXPORT_TEXT');
    return value;
}
export async function buildPublication(root: string, home: Home, selection: Selection) {
    if (home.revision !== selection.expectedRevision)
        throw Error('REVISION_CONFLICT');
    const eligible = (v?: string) => v === 'public' || (selection.audience === 'invited' && v === 'invited');
    const scenes = home.scenes.filter(s => selection.sceneIds.includes(s.id));
    const objects = home.objects.filter(o => selection.objectIds.includes(o.id));
    if (scenes.length !== new Set(selection.sceneIds).size || objects.length !== new Set(selection.objectIds).size ||
        scenes.some(s => !eligible(s.visibility) || !selection.mediaIds.includes(s.mediaId)) ||
        objects.some(o => !eligible(o.visibility) || !rootHasHotspot(home, o.id, new Set(selection.sceneIds)) || ancestorIds(home.objects,o.id).some(id=>!selection.objectIds.includes(id))))
        throw Error('INVALID_SELECTION');
    const id = randomUUID(), staged = path.join(root, 'publications', `.stage-${id}`), final = path.join(root, 'publications', id);
    const mediaMap = new Map<string, string>();
    const sceneMap = new Map(scenes.map((s, i) => [s.id, `scene-${i + 1}`]));
    const objectMap = new Map(objects.map((o, i) => [o.id, `object-${i + 1}`]));
    mkdirSync(staged, { recursive: true, mode: 0o700 });
    try {
        const copyMedia = async (sourceId: string) => {
            if (!selection.mediaIds.includes(sourceId))
                return undefined;
            if (mediaMap.has(sourceId))
                return mediaMap.get(sourceId)!;
            const targetId = `media-${mediaMap.size + 1}`;
            const source = path.join(root, 'media', sourceId), target = path.join(staged, 'media', targetId);
            const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
            mkdirSync(target, { recursive: true, mode: 0o700 });
            if (manifest.kind === 'video') {
                // This file was transcoded locally, with metadata and non-audiovisual streams removed.
                copyFileSync(path.join(source, 'video.mp4'), path.join(target, 'video.mp4'));
                writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ id: targetId, kind: 'video', levels: [], width: manifest.width, height: manifest.height }));
            }
            else if(manifest.kind === 'document') {
                if(manifest.mime==='text/plain')safeText(readFileSync(path.join(source,'document.txt'),'utf8'));
                const filename=manifest.mime==='application/pdf'?'document.pdf':'document.txt';
                copyFileSync(path.join(source,filename),path.join(target,filename));
                writeFileSync(path.join(target,'manifest.json'),JSON.stringify({id:targetId,kind:'document',mime:manifest.mime,filename,levels:[]}));
            } else {
                for (const filename of readdirSync(source)) {
                    if (!/^(preview|\d+-\d+-\d+)\.jpg$/.test(filename))
                        continue;
                    await sharp(path.join(source, filename)).rotate().jpeg({ quality: 88 }).toFile(path.join(target, filename));
                }
                writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ id: targetId, kind: manifest.kind ?? 'panorama', width: manifest.width, height: manifest.height, levels: manifest.levels }));
            }
            mediaMap.set(sourceId, targetId);
            return targetId;
        };
        const exported: HomeObject[] = [];
        for (const o of objects) {
            const experience = resolveObjectExperience(o, 'showroom');
            const actions: HomeObject['actions'] = [];
            for (const a of experience.actions) {
                if (a.type === 'info')
                    actions.push({ type: 'info' });
                if (a.type === 'portal' && sceneMap.has(a.sceneId))
                    actions.push({ type: 'portal', sceneId: sceneMap.get(a.sceneId)! });
                if (a.type === 'demo')
                    actions.push({ type: 'demo', demo: a.demo });
                if (a.type === 'link')
                    actions.push({ type: 'link', label: safeText(a.label), url: a.url });
                if (a.type === 'app')
                    actions.push({ type: 'app', label: safeText(a.label), url: a.url, fallbackUrl: a.fallbackUrl });
            }
            const showcase: NonNullable<HomeObject['showcase']> = [];
            for (const card of experience.showcase ?? []) {
                const action = card.action;
                if (action.type === 'portal' && !sceneMap.has(action.sceneId)) continue;
                const safeAction = action.type === 'info' ? { type: 'info' as const }
                    : action.type === 'portal' ? { type: 'portal' as const, sceneId: sceneMap.get(action.sceneId)! }
                    : action.type === 'demo' ? { type: 'demo' as const, demo: action.demo }
                    : action.type === 'link' ? { type: 'link' as const, label: safeText(action.label), url: action.url }
                    : { type: 'app' as const, label: safeText(action.label), url: action.url, fallbackUrl: action.fallbackUrl };
                showcase.push({
                    id: `card-${exported.length + 1}-${showcase.length + 1}`,
                    title: safeText(card.title),
                    description: card.description ? safeText(card.description) : undefined,
                    brand: card.brand,
                    mediaId: card.mediaId ? await copyMedia(card.mediaId) : undefined,
                    action: safeAction,
                });
            }
            const gallery = [];
            for (const m of experience.gallery ?? []) {
                const copied = await copyMedia(m);
                if (copied)
                    gallery.push(copied);
            }
            const documents:NonNullable<HomeObject['documents']>=[];
            for(const d of o.documents??[]){
                if(!eligible(d.visibility))continue;
                const copied=await copyMedia(d.mediaId);
                if(copied)documents.push({id:`document-${exported.length+1}-${documents.length+1}`,mediaId:copied,title:safeText(d.title),mime:d.mime,visibility:selection.audience});
            }
            exported.push({ id: objectMap.get(o.id)!, roomId: `room-${scenes.findIndex(s => s.roomId === o.roomId) + 1}`,
                name: safeText(experience.name), description: safeText(experience.description), category: safeText(o.category ?? 'object'),
                kind:o.kind,parentId:o.parentId?objectMap.get(o.parentId):undefined,detailPosition:o.detailPosition,
                documentation: safeText(o.documentation ?? ''), specifications: (o.specifications ?? []).map(s => ({ label: safeText(s.label), value: safeText(s.value) })),
                mediaId: experience.mediaId ? await copyMedia(experience.mediaId) : undefined, videoId: experience.videoId ? await copyMedia(experience.videoId) : undefined,
                gallery, showcase, documents, actions: actions.length ? actions : [{ type: 'info' }], visibility: selection.audience,
                capabilities: o.capabilities?.filter(capability=>!/(control|device|provider|integration)/i.test(capability)) });
        }
        const rooms = [...new Set(scenes.map(s => s.roomId))].map(r => {
            const first = scenes.findIndex(s => s.roomId === r);
            return { id: `room-${first + 1}`, floorId: 'tour-floor', name: safeText(home.rooms.find(x => x.id === r)!.name) };
        });
        for (const scene of scenes)
            await copyMedia(scene.mediaId);
        const document = homeSchema.parse({ schemaVersion: 1, id, name: safeText(selection.title), demo: false, revision: 1,
            floors: [{ id: 'tour-floor', name: 'Virtual Tour' }], rooms,
            scenes: await Promise.all(scenes.map(async (s, i) => ({ id: sceneMap.get(s.id), roomId: `room-${scenes.findIndex(x => x.roomId === s.roomId) + 1}`,
                name: safeText(s.name), mediaId: await copyMedia(s.mediaId), initial: { yaw: s.initial.yaw, pitch: s.initial.pitch },
                hotspots: s.hotspots.filter(h => objectMap.has(h.objectId)).map((h, j) => ({ id: `pin-${i + 1}-${j + 1}`, objectId: objectMap.get(h.objectId), position: { yaw: h.position.yaw, pitch: h.position.pitch } })) }))), objects: exported });
        writeFileSync(path.join(staged, 'home.json'), JSON.stringify(document), { mode: 0o600 });
        renameSync(staged, final);
        return { id, document };
    }
    catch (e) {
        rmSync(staged, { recursive: true, force: true });
        throw e;
    }
}

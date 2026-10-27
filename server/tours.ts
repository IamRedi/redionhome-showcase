import type { Express, Request, Response, RequestHandler } from 'express';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { grantSchema, invitationSchema, selectionSchema, type Grant } from '../shared/access.ts';
import { homeSchema, type Role } from '../shared/model.ts';
import type { Store } from './store.ts';
import { buildPublication } from './publication.ts';
import { documentDownloadHeaders } from './documents.ts';
import { ancestorIds, rootHasHotspot } from '../shared/hierarchy.ts';
export type Identity = {
    id: string;
    role: Role;
    grant?: Grant;
};
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
type Publication = {
    id: string;
    title: string;
    audience: 'invited' | 'public';
    source_revision: number;
    document: string;
    approved: number;
    created_at: string;
};
export function mountTours(app: Express, store: Store, root: string, owner: RequestHandler, identity: (req: Request) => Identity | undefined, origin: URL) {
    const publication = (id: string) => store.db.prepare('SELECT * FROM publications WHERE id=?').get(id) as Publication | undefined;
    const exposed = (audience: string, id: string) => !!store.db.prepare('SELECT 1 FROM exposure WHERE audience=? AND publication_id=?').get(audience, id);
    const allowed = (req: Request, id: string) => {
        const p = publication(id), u = identity(req);
        if (!p)
            return undefined;
        if (u?.role === 'owner')
            return p;
        if (p.approved !== 1)
            return undefined;
        if (p.audience === 'public' && exposed('public', id))
            return p;
        if (u?.role === 'invited_guest' && u.grant?.publicationId === id && exposed('invited', id))
            return p;
        return undefined;
    };
    app.get('/api/v1/publications', owner, (_req, res) => res.json({
        versions: store.db.prepare('SELECT id,title,audience,source_revision,approved,created_at FROM publications ORDER BY rowid DESC').all(),
        exposure: store.db.prepare('SELECT * FROM exposure').all(),
    }));
    app.post('/api/v1/publications', owner, async (req, res) => {
        const selection = selectionSchema.parse(req.body);
        const result = await buildPublication(root, store.home(), selection);
        store.db.prepare('INSERT INTO publications(id,title,audience,source_revision,document) VALUES(?,?,?,?,?)').run(result.id, selection.title, selection.audience, selection.expectedRevision, JSON.stringify(result.document));
        store.audit('owner', 'publication.draft', result.id);
        res.status(201).json({ id: result.id, title: selection.title, audience: selection.audience, status: 'draft', previewPath: `/tour/${result.id}` });
    });
    app.post('/api/v1/publications/:id/activate', owner, (req, res) => {
        const input = z.object({ approved: z.literal(true) }).strict().parse(req.body), p = publication(String(req.params.id));
        if (!p) {
            res.status(404).json({ error: 'NOT_FOUND' });
            return;
        }
        if (input.approved)
            store.db.transaction(() => {
                store.db.prepare('UPDATE publications SET approved=1 WHERE id=?').run(p.id);
                store.db.prepare('UPDATE exposure SET publication_id=? WHERE audience=?').run(p.id, p.audience);
                store.audit('owner', 'publication.approve', `${p.audience}:${p.id}`);
            })();
        res.json({ id: p.id, audience: p.audience, status: 'active', path: `/tour/${p.id}` });
    });
    app.post('/api/v1/publications/disable', owner, (req, res) => {
        const { audience } = z.object({ audience: z.enum(['invited', 'public']) }).strict().parse(req.body);
        store.db.prepare('UPDATE exposure SET publication_id=NULL WHERE audience=?').run(audience);
        store.audit('owner', 'publication.disable', audience);
        res.status(204).end();
    });
    app.get('/api/v1/access', owner, (_req, res) => res.json(store.db.prepare('SELECT user_id,role,label,expires,revoked,max_sessions,grant_json FROM access ORDER BY rowid DESC').all()));
    app.post('/api/v1/invitations', owner, (req, res) => {
        const input = invitationSchema.parse(req.body), home = store.home();
        if (input.role === 'invited_guest') {
            const p = input.grant.publicationId ? publication(input.grant.publicationId) : undefined;
            if (!p || p.audience !== 'invited' || !p.approved || !exposed('invited', p.id) || input.grant.sceneIds.length || input.grant.objectIds.length || input.grant.commandObjectIds.length) {
                res.status(400).json({ error: 'INVALID_GRANT' });
                return;
            }
        }
        else {
            const g = input.grant;
            const sceneIds=new Set(g.sceneIds);
            if (g.publicationId || !g.sceneIds.length || g.sceneIds.some(id => !home.scenes.some(s => s.id === id)) || g.objectIds.some(id => !home.objects.some(o => o.id === id && o.permissions?.householdView === true && rootHasHotspot(home,o.id,sceneIds) && ancestorIds(home.objects,o.id).every(parentId=>g.objectIds.includes(parentId)&&home.objects.find(parent=>parent.id===parentId)?.permissions?.householdView===true))) || g.commandObjectIds.some(id => !g.objectIds.includes(id) || !home.objects.some(o => o.id === id && o.permissions?.householdControl === true))) {
                res.status(400).json({ error: 'INVALID_GRANT' });
                return;
            }
        }
        const id = randomUUID(), token = randomBytes(32).toString('base64url'), expires = Date.now() + input.expiresHours * 3600000;
        store.db.transaction(() => {
            store.db.prepare('INSERT INTO users VALUES(?,?,?)').run(id, 'invitation-only', 'viewer');
            store.db.prepare('INSERT INTO access(user_id,role,label,grant_json,expires,max_sessions) VALUES(?,?,?,?,?,?)').run(id, input.role, input.label, JSON.stringify(input.grant), expires, input.maxSessions);
            store.db.prepare('INSERT INTO invitations VALUES(?,?)').run(hashToken(token), id);
            store.audit('owner', 'access.invite', id);
        })();
        // Token is returned only once; never stored in plaintext, URL query, logs or export.
        res.status(201).json({ id, token, expires, role: input.role, path: input.role === 'invited_guest' ? `/tour/${input.grant.publicationId}#invite=${token}` : `/#invite=${token}` });
    });
    app.post('/api/v1/invitations/redeem', rateLimit({ windowMs: 900000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }), (req, res) => {
        const { token } = z.object({ token: z.string().min(32).max(128) }).strict().parse(req.body);
        const access = store.db.prepare('SELECT access.* FROM invitations JOIN access ON access.user_id=invitations.user_id WHERE invitations.token_hash=?').get(hashToken(token)) as {
            user_id: string;
            role: Role;
            grant_json: string;
            expires: number;
            revoked: number;
            max_sessions: number;
        } | undefined;
        if (!access || access.revoked || access.expires <= Date.now()) {
            res.status(401).json({ error: 'INVITATION_INVALID' });
            return;
        }
        const session = randomBytes(32).toString('hex'), expires = Math.min(access.expires, Date.now() + 12 * 3600000);
        const created = store.db.transaction(() => {
            store.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
            const n = store.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(access.user_id) as {
                n: number;
            };
            if (n.n >= access.max_sessions)
                return false;
            store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(session), access.user_id, expires);
            store.audit(access.user_id, 'access.redeem', '');
            return true;
        })();
        if (!created) {
            res.status(409).json({ error: 'SESSION_LIMIT' });
            return;
        }
        res.cookie('roh_session', session, { httpOnly: true, sameSite: 'strict', secure: (res.locals.requestOrigin as URL|undefined)?.protocol === 'https:' || origin.protocol === 'https:', maxAge: expires - Date.now(), path: '/' });
        res.json({ role: access.role, publicationId: grantSchema.parse(JSON.parse(access.grant_json)).publicationId });
    });
    app.post('/api/v1/access/:id/revoke', owner, (req, res) => {
        store.db.transaction(() => {
            store.db.prepare('UPDATE access SET revoked=1 WHERE user_id=?').run(String(req.params.id));
            store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(String(req.params.id));
            store.audit('owner', 'access.revoke', String(req.params.id));
        })();
        res.status(204).end();
    });
    app.get('/api/v1/tours/:id/home', (req, res) => {
        const p = allowed(req, String(req.params.id));
        if (!p) {
            res.status(403).json({ error: 'TOUR_NOT_ALLOWED' });
            return;
        }
        res.json(homeSchema.parse(JSON.parse(p.document)));
    });
    app.get('/api/v1/tours/:id/media/:media/:file', (req: Request, res: Response) => {
        const p = allowed(req, String(req.params.id));
        if (!p) {
            res.status(403).json({ error: 'TOUR_NOT_ALLOWED' });
            return;
        }
        const media = String(req.params.media), file = String(req.params.file);
        if (!/^media-\d+$/.test(media) || !/^(manifest|preview\.jpg|video\.mp4|document\.(pdf|txt)|\d+-\d+-\d+\.jpg)$/.test(file)) {
            res.status(404).end();
            return;
        }
        const filename = path.resolve(root, 'publications', p.id, 'media', media, file === 'manifest' ? 'manifest.json' : file);
        if (!existsSync(filename)) {
            res.status(404).end();
            return;
        }
        res.set('Cache-Control', 'no-store');
        if(/^document\./.test(file))res.set(documentDownloadHeaders(file.endsWith('.pdf')?'application/pdf':'text/plain'));
        res.sendFile(filename, { dotfiles: 'allow' });
    });
}

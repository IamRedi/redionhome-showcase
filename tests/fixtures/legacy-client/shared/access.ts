import { z } from 'zod';
import { idSchema } from './model.ts';
export const grantSchema = z.object({
    sceneIds: z.array(idSchema).max(200).default([]),
    objectIds: z.array(idSchema).max(1000).default([]),
    commandObjectIds: z.array(idSchema).max(1000).default([]),
    publicationId: idSchema.optional(),
}).strict();
export type Grant = z.infer<typeof grantSchema>;
export const invitationSchema = z.object({
    label: z.string().trim().min(1).max(100),
    role: z.enum(['household', 'invited_guest']),
    expiresHours: z.number().int().min(1).max(720),
    maxSessions: z.number().int().min(1).max(5),
    grant: grantSchema,
}).strict();
export const selectionSchema = z.object({
    title: z.string().trim().min(1).max(120),
    audience: z.enum(['invited', 'public']),
    sceneIds: z.array(idSchema).min(1).max(200),
    objectIds: z.array(idSchema).max(1000),
    mediaIds: z.array(idSchema).max(2000),
    expectedRevision: z.number().int().positive(),
}).strict();
export type Selection = z.infer<typeof selectionSchema>;

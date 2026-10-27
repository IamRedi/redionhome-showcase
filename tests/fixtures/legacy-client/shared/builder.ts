import { z } from 'zod';
import { idSchema, positionSchema } from './model.ts';

export const roomImportSchema = z.object({
  expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  homeName: z.string().trim().min(1).max(120).optional(),
  mediaId: idSchema,
  replaceSceneId: idSchema.optional(),
  initial: positionSchema,
}).strict();
export type RoomImport = z.infer<typeof roomImportSchema>;
export type PanoramaImportStatus = {
  id: string;
  status: 'processing' | 'ready' | 'cancelled' | 'failed';
  progress: number;
  mediaId?: string;
  error?: string;
  elapsedMs: number;
};

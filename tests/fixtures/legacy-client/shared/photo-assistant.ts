import { z } from 'zod';
import { idSchema } from './model.ts';
export const photoFieldsSchema=z.object({name:z.string().trim().min(1).max(120),category:z.string().trim().min(1).max(80),description:z.string().max(2000)}).strict();
export const photoRequestSchema=z.object({objectId:idSchema.optional(),photoMediaId:idSchema,expectedRevision:z.number().int().positive(),consent:z.literal(true)}).strict();
export const confirmPhotoSchema=z.object({suggestionId:idSchema,expectedRevision:z.number().int().positive(),confirmed:z.literal(true),corrected:photoFieldsSchema}).strict();
export type PhotoFields=z.infer<typeof photoFieldsSchema>;
export interface PhotoSuggestionProvider {
 id:string;
 label:string;
 destination:string;
 suggest(photo:Buffer,signal:AbortSignal):Promise<PhotoFields>;
}

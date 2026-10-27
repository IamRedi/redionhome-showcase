import {z} from 'zod';
import {objectSchema,positionSchema,visibilitySchema,actionSchema,privateActionSchema,visitorActionSchema,objectExperiencesSchema,showcaseCardSchema} from './model.ts';
// Session drafts can be stale or malformed. Validate before placing them in UI state.
export const roomDraftSchema=z.object({mode:z.enum(['new','replace','home']),target:z.string(),name:z.string().max(120),homeName:z.string().max(120),media:z.string(),initial:positionSchema}).strict();
// Drafts are editor input, not publishable documents. Preserve incomplete URLs/labels
// for recovery; the shared home schema and backend validate them before preview/save.
const draftLink=z.object({type:z.literal('link'),label:z.string().max(120),url:z.string().max(1000)}).strict();
const draftApp=z.object({type:z.literal('app'),label:z.string().max(120),url:z.string().max(1000),fallbackUrl:z.string().max(1000)}).strict();
const draftActions=z.union([actionSchema,draftLink,draftApp]);
const draftPrivateActions=z.union([privateActionSchema,draftLink,draftApp]);
const draftVisitorActions=z.union([visitorActionSchema,draftLink,draftApp]);
const cards=z.array(showcaseCardSchema.extend({title:z.string().max(120),action:draftVisitorActions})).max(12);
const profiles=objectExperiencesSchema.extend({
 private:objectExperiencesSchema.shape.private.unwrap().extend({title:z.string().max(120).optional(),actions:z.array(draftPrivateActions).max(8).optional(),showcase:cards.optional()}).optional(),
 showroom:objectExperiencesSchema.shape.showroom.unwrap().extend({title:z.string().max(120).optional(),actions:z.array(draftVisitorActions).max(8).optional(),showcase:cards.optional()}).optional(),
});
const draftExtensions=objectSchema.partial().extend({actions:z.array(draftActions).max(8).optional(),showcase:cards.optional(),experiences:profiles.optional()});
export const objectDraftSchema=z.object({revision:z.number().int().positive(),objectId:z.string().optional(),draft:z.object({selected:z.string(),name:z.string().max(120),description:z.string().max(2000),yaw:z.number().min(-360).max(360),pitch:z.number().min(-90).max(90),parentId:z.string(),detailX:z.number().min(0).max(100),detailY:z.number().min(0).max(100),primary:z.enum(['info','portal','device']),target:z.string(),actionChanged:z.boolean(),detachMockLight:z.boolean().default(false),extensions:draftExtensions,roomName:z.string().max(120),sceneVisibility:visibilitySchema,mediaId:z.string()}).strict()}).strict();

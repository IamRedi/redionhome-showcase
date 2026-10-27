import {z} from 'zod';
import {idSchema} from './model.ts';
import type {ActionRun} from './actions.ts';

export const aiHistorySchema=z.object({role:z.enum(['user','assistant']),text:z.string().trim().min(1).max(2000)}).strict();
export const aiRequestSchema=z.object({
 message:z.string().trim().min(1).max(1200),
 history:z.array(aiHistorySchema).max(8).default([]),
 photoMediaId:idSchema.optional(),
 photoConsent:z.literal(true).optional(),
 requestId:z.string().uuid().optional(),
 channel:z.enum(['text','voice']).default('text'),
 referenceRunId:idSchema.optional(),
}).strict().superRefine((value,ctx)=>{
 if(value.photoMediaId&&value.photoConsent!==true)ctx.addIssue({code:'custom',message:'AI_PHOTO_CONSENT_REQUIRED'});
 if(value.photoConsent&&!value.photoMediaId)ctx.addIssue({code:'custom',message:'AI_PHOTO_REQUIRED'});
});

export const aiInventoryItemSchema=z.object({
 name:z.string().trim().min(1).max(120),
 quantity:z.string().trim().min(1).max(80),
 location:z.string().trim().max(120),
 confidence:z.enum(['high','medium','low']),
}).strict();

export const aiProviderResultSchema=z.object({
 reply:z.string().trim().min(1).max(3000),
 navigation:z.object({type:z.enum(['none','scene','object']),targetId:z.string().max(80).nullable()}).strict(),
 commands:z.array(z.object({
  objectId:z.string().max(80),
  action:z.enum(['turn_on','turn_off','set_brightness']),
  brightness:z.number().int().min(1).max(100).nullable(),
  reason:z.string().trim().min(1).max(240),
 }).strict()).max(8),
 inventory:z.array(aiInventoryItemSchema).max(80),
 limitations:z.array(z.string().trim().min(1).max(300)).max(10),
 targetResolution:z.enum(['exact','ambiguous','none']).optional(),
 ambient:z.object({operation:z.enum(['save','run']),id:idSchema.nullable(),name:z.string().trim().min(1).max(80).nullable(),roomId:idSchema.nullable()}).strict().nullable().optional(),
}).strict();

export const confirmInventorySchema=z.object({
 suggestionId:idSchema,
 expectedRevision:z.number().int().positive(),
 confirmed:z.literal(true),
 items:z.array(aiInventoryItemSchema).min(1).max(80),
}).strict();

export type AIHistory=z.infer<typeof aiHistorySchema>;
export type AIInventoryItem=z.infer<typeof aiInventoryItemSchema>;
export type AIProviderResult=z.infer<typeof aiProviderResultSchema>;
export type AICommandProposal=AIProviderResult['commands'][number]&{confirmEntityId?:string};
export type AIResponse=Omit<AIProviderResult,'commands'>&{
 commands:AICommandProposal[];
 provider:string;
 model:string;
 inventorySuggestionId?:string;
 execution?:ActionRun;
 usage?:{inputTokens:number;outputTokens:number};
};

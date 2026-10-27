import {z} from 'zod';
import {idSchema} from './model.ts';

export const actionSchema=z.object({objectId:idSchema,action:z.enum(['turn_on','turn_off','set_brightness']),brightness:z.number().int().min(1).max(100).optional(),confirmEntityId:z.string().max(100).optional()}).strict().superRefine((v,c)=>{if(v.action==='set_brightness'&&v.brightness===undefined)c.addIssue({code:'custom',message:'BRIGHTNESS_REQUIRED'});if(v.action!=='set_brightness'&&v.brightness!==undefined)c.addIssue({code:'custom',message:'BRIGHTNESS_NOT_APPLICABLE'});});
export type HomeAction=z.infer<typeof actionSchema>;
export const actionsSchema=z.array(actionSchema).min(1).max(8).superRefine((v,c)=>{if(new Set(v.map(a=>a.objectId)).size!==v.length)c.addIssue({code:'custom',message:'DUPLICATE_TARGET'});});
export const policyInputSchema=z.object({expectedVersion:z.number().int().nonnegative(),mode:z.enum(['advise','confirm','auto']),duration:z.enum(['session','persistent']),grants:z.array(z.object({objectId:idSchema,actions:z.array(z.enum(['turn_on','turn_off','set_brightness'])).min(1).max(3),maxBrightness:z.number().int().min(1).max(100)}).strict()).max(24)}).strict();
export type ActionGrant=z.infer<typeof policyInputSchema>['grants'][number]&{identity:string};
export type ActionPolicy={version:number;mode:'advise'|'confirm'|'auto';duration:'session'|'persistent';grants:ActionGrant[];active:boolean};
export type ActionTarget={objectId:string;name:string;roomId:string;identity:string;provider:string;entityId?:string;actions:HomeAction['action'][];available:boolean;brightness:number|null;state:string;sourceObservedAt:string|null};
export const runStatusSchema=z.enum(['awaiting_confirmation','running','succeeded','partial','failed','stopped','interrupted','expired','blocked','uncertain']);
export type RunStatus=z.infer<typeof runStatusSchema>;
export type ActionStep={index:number;command:HomeAction;identity:string;name:string;roomId:string;provider:string;status:'pending'|'dispatching'|'confirmed'|'failed'|'uncertain'|'skipped';error:string|null;before:unknown;after:unknown;startedAt:string|null;endedAt:string|null};
export type ActionRun={id:string;requestId:string;actor:string;source:'manual'|'ai'|'ambient';channel:'button'|'text'|'voice';status:RunStatus;policyVersion:number;ambientId:string|null;ambientVersion:number|null;failureMode:'stop'|'continue';expiresAt:number;stopRequested:boolean;createdAt:string;endedAt:string|null;steps:ActionStep[]};
export type Ambient={id:string;version:number;name:string;roomId:string;favorite:boolean;deleted:boolean;failureMode:'stop'|'continue';steps:{command:HomeAction;identity:string;name:string;roomId:string;provider:string}[]};
export const ambientInputSchema=z.object({id:idSchema.optional(),expectedVersion:z.number().int().positive().optional(),name:z.string().trim().min(1).max(80),roomId:idSchema,favorite:z.boolean().default(false),deleted:z.boolean().default(false),failureMode:z.enum(['stop','continue']).default('stop'),steps:actionsSchema.optional(),runId:idSchema.optional()}).strict().superRefine((v,c)=>{if(!!v.steps===!!v.runId)c.addIssue({code:'custom',message:'ONE_AMBIENT_SOURCE_REQUIRED'});if(!!v.id!==!!v.expectedVersion)c.addIssue({code:'custom',message:'AMBIENT_VERSION_REQUIRED'});});
export const requestIdSchema=z.string().uuid();

import {z} from 'zod';
import {idSchema} from './model.ts';

export const productIdSchema=z.enum(['piano-core','led-wall','philips-tv','bambu-lab']);
export type ProductId=z.infer<typeof productIdSchema>;
export const productNames:Record<ProductId,string>={'piano-core':'Piano Core','led-wall':'LED Wall','philips-tv':'TV','bambu-lab':'Bambu A1'};
// Operator-owned private configuration. No client-supplied network destination.
const originSchema=z.string().max(300).refine(value=>{
 try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&u.origin===value&&!u.username&&!u.password&&u.hostname!=='';}catch{return false;}
});
export const productConnectionSchema=z.object({
 objectId:idSchema,product:productIdSchema,origin:originSchema.optional(),
 expectedDeviceId:z.string().trim().min(1).max(100).optional(),
 sensors:z.partialRecord(z.enum(['status','progress','remaining','nozzle','bed','error']),z.string().regex(/^sensor\.[a-z0-9_]+$/)).optional(),
}).strict().superRefine((v,c)=>{
 if(['piano-core','led-wall'].includes(v.product)&&!v.origin)c.addIssue({code:'custom',message:'PRODUCT_ORIGIN_REQUIRED'});
 if(v.product==='piano-core'&&!v.expectedDeviceId)c.addIssue({code:'custom',message:'PRODUCT_IDENTITY_REQUIRED'});
 if(['philips-tv','bambu-lab'].includes(v.product)&&v.origin)c.addIssue({code:'custom',message:'PRODUCT_USES_EXISTING_HA'});
 if(v.product!=='bambu-lab'&&v.sensors)c.addIssue({code:'custom',message:'PRODUCT_SENSORS_UNSUPPORTED'});
});
export const productConfigSchema=z.object({version:z.literal(1),connections:z.array(productConnectionSchema).max(32)}).strict().superRefine((v,c)=>{
 if(new Set(v.connections.map(x=>x.objectId)).size!==v.connections.length)c.addIssue({code:'custom',message:'PRODUCT_DUPLICATE_OBJECT'});
 const native=v.connections.filter(x=>x.origin);
 if(new Set(native.map(x=>x.origin)).size!==native.length||new Set(native.filter(x=>x.expectedDeviceId).map(x=>`${x.product}:${x.expectedDeviceId}`)).size!==native.filter(x=>x.expectedDeviceId).length)c.addIssue({code:'custom',message:'PRODUCT_DUPLICATE_DEVICE'});
});
export type ProductConnection=z.infer<typeof productConnectionSchema>;
export type ProductReading={label:string;value:string|number;unit?:string;sourceObservedAt:string|null};
export type ProductReport={
 objectId:string;product:ProductId;name:string;
 status:'unconfigured'|'online'|'degraded'|'offline'|'identity_unverified'|'identity_mismatch'|'configuration_error';
 identityVerified:boolean;readings:ProductReading[];presets:string[];
 launchUrl:string|null;launchLabel:string;message:string;receivedAt:string;
 commandSupported:false;physicalResult:'NOT_VERIFIED';
 unsupportedMetrics:string[];
};
export type ProductAIContext=Pick<ProductReport,'objectId'|'product'|'status'|'identityVerified'|'readings'|'receivedAt'|'commandSupported'|'unsupportedMetrics'>;

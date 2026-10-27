import {it,expect} from 'vitest';
import {roomDraftSchema,objectDraftSchema} from '../shared/drafts.ts';
it('corrupt session drafts cannot replace editor state',()=>{
 expect(roomDraftSchema.safeParse({mode:'home',target:'',name:'Room',homeName:'Home',media:'',initial:{yaw:0,pitch:0}}).success).toBe(true);
 expect(roomDraftSchema.safeParse({mode:'home',initial:null}).success).toBe(false);
 expect(objectDraftSchema.safeParse({revision:1,draft:{extensions:null}}).success).toBe(false);
});

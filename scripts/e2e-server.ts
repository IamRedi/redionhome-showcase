import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = mkdtempSync(path.join(os.tmpdir(), "redionhome-e2e-"));
process.env.DATA_DIR = root;
process.env.PORT = "4184";
process.env.APP_ORIGIN = "http://127.0.0.1:4184";
process.env.OWNER_PASSWORD = "disposable-e2e-password-42";
process.env.NODE_ENV = "production";
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
const {startServer}=await import("../server/index.ts");
// The expanded desktop/mobile F1 suite has 42 fresh logins. Production limits
// are unchanged; this server and all its users/data are disposable.
await startServer({id:'synthetic-e2e',label:'TEST ONLY · synthetic suggestions',destination:'in-process test fixture',async suggest(){return {name:'Llambë prove AI',category:'Ndriçim',description:'Sugjerim sintetik për testim, jo analizë reale e fotos.'};}},{loginRateLimit:80,aiProvider:{id:'synthetic-chat-e2e',label:'TEST ONLY · synthetic chat',destination:'in-process test fixture',model:'synthetic-model',async respond({message}){return {reply:`Përgjigje prove: ${message}`,navigation:{type:'object',targetId:'light'},commands:message.toLocaleLowerCase('sq').includes('ndiz')?[{objectId:'light',action:'turn_on',brightness:null,reason:'Kërkesë e qartë prove.'}]:[],inventory:[],limitations:[]};}}});

import Database from 'better-sqlite3';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {buildIdentity} from './build-identity.ts';

const [mode,candidate,baseline,input,output]=process.argv.slice(2);
if(!['rehearse','apply'].includes(mode)||![candidate,baseline,input,output].every(p=>p&&path.isAbsolute(p)))throw Error('Explicit absolute migration paths required');
const manifest=JSON.parse(readFileSync(path.join(candidate,'dist/build.json'),'utf8'));
if(manifest.schemaRevision!==8||manifest.sourceHash!==buildIdentity(candidate).sourceHash)throw Error('Migration candidate source mismatch');
type Fingerprints=Record<string,string>;
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fingerprints(db:Database.Database):Fingerprints{
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'migrations' ORDER BY name").pluck().all() as string[];
 return Object.fromEntries(tables.map(name=>[name,sha(JSON.stringify(db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()))]));
}
function check(db:Database.Database,expected:Fingerprints){
 if(db.pragma('integrity_check',{simple:true})!=='ok'||(db.pragma('foreign_key_check') as unknown[]).length)throw Error('Migration integrity failed');
 const current=fingerprints(db);
 if(Object.entries(expected).some(([table,digest])=>current[table]!==digest))throw Error('Migration changed existing table content');
 if(JSON.stringify(db.prepare('SELECT version FROM migrations ORDER BY version').pluck().all())!==JSON.stringify([1,2,3,4,5,6,7,8]))throw Error('Unexpected migration sequence');
}
const {Store:CandidateStore}=await import(pathToFileURL(path.join(candidate,'server/store.ts')).href);
if(mode==='rehearse'){
 mkdirSync(output,{mode:0o700});chmodSync(output,0o700);
 const dbPath=path.join(output,'home.sqlite');copyFileSync(input,dbPath);chmodSync(dbPath,0o600);
 const beforeDb=new Database(dbPath,{readonly:true,fileMustExist:true}),before=fingerprints(beforeDb);
 if(beforeDb.prepare('SELECT max(version) FROM migrations').pluck().get()!==7)throw Error('F2 rehearsal requires schema 7');
 const revision=beforeDb.prepare('SELECT max(revision) FROM revisions').pluck().get();beforeDb.close();
 const after=new CandidateStore(output);check(after.db,before);after.close();
 // Prove the existing F1 Store can open the additive schema for code-only rollback.
 const {Store:BaselineStore}=await import(pathToFileURL(path.join(baseline,'server/store.ts')).href);
 const rollback=new BaselineStore(output);check(rollback.db,before);rollback.close();
 const evidence={sourceHash:manifest.sourceHash,buildId:manifest.buildId,fromSchema:7,toSchema:8,sourceBackupSha:sha(readFileSync(input)),revision,legacyTables:before,rollbackCompatible:true};
 writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 process.stdout.write('Schema 7 to 8 rehearsal and F1 code rollback compatibility verified\n');
}else{
 const evidence=JSON.parse(readFileSync(output,'utf8')) as {sourceHash:string;legacyTables:Fingerprints;rollbackCompatible:boolean};
 if(evidence.sourceHash!==manifest.sourceHash||evidence.rollbackCompatible!==true)throw Error('Migration rehearsal does not match candidate');
 const before=new Database(path.join(input,'home.sqlite'),{readonly:true,fileMustExist:true});
 if(before.prepare('SELECT max(version) FROM migrations').pluck().get()!==7)throw Error('Expected active schema 7; refusing implicit migration retry');
 const current=fingerprints(before);before.close();
 if(JSON.stringify(current)!==JSON.stringify(evidence.legacyTables))throw Error('Data changed after backup; make a fresh backup and rehearsal');
 const active=new CandidateStore(input);check(active.db,evidence.legacyTables);active.close();
 process.stdout.write('Additive schema 8 applied; existing table content preserved\n');
}

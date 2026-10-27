import Database from 'better-sqlite3';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
const [source,backup,candidate]=process.argv.slice(2);
// Verify every non-SQLite file, including private media and credentials, without
// logging their names or contents. SQLite is verified from its online snapshot.
function verify(dir=''){
  for(const entry of readdirSync(path.join(source,dir))){
    if(!dir&&/^home\.sqlite(?:-wal|-shm)?$/.test(entry))continue;
    const name=path.join(dir,entry),from=path.join(source,name),to=path.join(backup,'data',name);
    const stat=lstatSync(from);
    if(stat.isSocket())continue;
    if(stat.isSymbolicLink())throw Error('Data backup contains an unexpected symlink');
    if(stat.isDirectory())verify(name);
    else if(!readFileSync(from).equals(readFileSync(to)))throw Error('Data changed during backup; retry from a fresh checkpoint');
  }
}
verify();
const db=new Database(path.join(backup,'home.sqlite'),{readonly:true,fileMustExist:true});
const schema=db.prepare('SELECT max(version) FROM migrations').pluck().get();
const manifest=JSON.parse(readFileSync(path.join(candidate,'dist/build.json'),'utf8'));
// The ordinary installer never upgrades schema. F2's explicit path permits only
// 7 -> 8 here, then requires a source-bound rehearsal before applying anything.
const f2Rehearsal=process.argv[5]==='--schema-7-to-8'&&schema===7&&manifest.schemaRevision===8;
if(schema!==manifest.schemaRevision&&!f2Rehearsal)throw Error('Schema mismatch; migration rehearsal required');
if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)throw Error('Backup integrity failed');
db.close();

import Database from 'better-sqlite3';
import {existsSync,mkdirSync,cpSync,rmSync,renameSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {homeSchema} from '../shared/model.ts';
export function exportPublication(root:string,id:string,target:string,client:string){
 if(!/^[\w-]{1,80}$/.test(id)||existsSync(target))throw Error('Use an existing approved ID and a new export directory');
 const db=new Database(path.join(root,'home.sqlite'),{readonly:true});
 let p:{approved:number;audience:string;document:string}|undefined;
 try{p=db.prepare('SELECT approved,audience,document FROM publications WHERE id=?').get(id) as typeof p;}finally{db.close();}
 if(!p||p.approved!==1||p.audience!=='public')throw Error('Only owner-approved public snapshots can be exported without an identity server');
 const home=homeSchema.parse(JSON.parse(p.document)),source=path.join(root,'publications',id);
 if(JSON.stringify(home)!==JSON.stringify(homeSchema.parse(JSON.parse(readFileSync(path.join(source,'home.json'),'utf8')))))throw Error('Artifact identity mismatch');
 const stage=`${target}.stage-${randomUUID()}`;
 try{mkdirSync(stage,{recursive:true,mode:0o700});cpSync(source,path.join(stage,'tour'),{recursive:true});cpSync(client,path.join(stage,'client'),{recursive:true});renameSync(stage,target);}catch(e){rmSync(stage,{recursive:true,force:true});throw e;}
 return {id,path:target};
}

import {cpSync,lstatSync} from 'node:fs';
import process from 'node:process';
// Unix daemon sockets are live endpoints, not recoverable data.
// Credentials, media and ordinary files remain in the private backup.
cpSync(process.argv[2],process.argv[3],{
  recursive:true,preserveTimestamps:true,errorOnExist:true,force:false,
  filter:source=>!lstatSync(source).isSocket(),
});

import {execFileSync} from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
execFileSync(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'--noEmit'],{stdio:'inherit'});
execFileSync(process.execPath,[path.resolve('node_modules/vite/bin/vite.js'),'build'],{
  stdio:'inherit',env:{...process.env,REDIONHOME_SHOWCASE_BUILD:'1'},
});

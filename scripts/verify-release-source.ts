import {readFileSync} from 'node:fs';
import path from 'node:path';
import {buildIdentity} from './build-identity.ts';
const root=process.argv[2];
const manifest=JSON.parse(readFileSync(path.join(root,'dist/build.json'),'utf8'));
const commit=readFileSync(path.join(root,'.source-sha'),'utf8').trim();
if(!/^[a-f0-9]{40}$/.test(commit)||manifest.sourceCommit!==commit)throw Error('Source commit manifest mismatch');
const source=buildIdentity(root);
if(source.sourceHash!==manifest.sourceHash||source.buildId!==manifest.buildId)throw Error('Executable source differs from tested build');

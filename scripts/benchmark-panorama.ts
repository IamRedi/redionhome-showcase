// Disposable synthetic panorama benchmark. Never reads owner media or database.
import {mkdtempSync,rmSync,statSync,readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {importPanorama} from '../server/media.ts';
const root=mkdtempSync(path.join(os.tmpdir(),'redionhome-benchmark-'));
try{
 const source=path.join(root,'synthetic.jpg');await sharp({create:{width:8192,height:4096,channels:3,background:'#557c66'}}).jpeg().toFile(source);
 const start=performance.now();await importPanorama(source,root,'synthetic');
 const files=readdirSync(path.join(root,'media/synthetic'));
 console.log(JSON.stringify({source:'synthetic uniform 8192x4096 JPEG',elapsedMs:Math.round(performance.now()-start),processMaxRssKiB:process.resourceUsage().maxRSS,derivativeBytes:files.filter(f=>f!=='original').reduce((sum,f)=>sum+statSync(path.join(root,'media/synthetic',f)).size,0),fileCount:files.length,hardwareAcceptance:'NOT_VERIFIED',limitation:'Uniform synthetic image; timings are local CPU measurements, not typical phone-photo or GPU memory measurements.'},null,2));
}finally{rmSync(root,{recursive:true,force:true});}

import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync,renameSync,rmSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
const run=promisify(execFile);

// A deliberately small image-only PDF writer: no imported objects, URLs, scripts,
// attachments, forms or metadata survive rendering. Each JPEG becomes one page.
export function imageOnlyPdf(pages:{jpeg:Buffer;width:number;height:number}[]):Buffer {
 const objects:Buffer[]=[];
 const add=(value:string|Buffer)=>objects.push(typeof value==='string'?Buffer.from(value):value);
 add('<< /Type /Catalog /Pages 2 0 R >>');
 add(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
 pages.forEach((page,i)=>{
  const pageId=3+i*3,imageId=pageId+1,contentId=pageId+2;
  const w=595,h=Math.round(w*page.height/page.width);
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`),page.jpeg,Buffer.from('\nendstream')]));
  const content=`q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
  add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
 });
 const parts=[Buffer.from('%PDF-1.4\n')],offsets=[0];let offset=parts[0].length;
 objects.forEach((object,i)=>{offsets.push(offset);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);parts.push(part);offset+=part.length;});
 parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
 return Buffer.concat(parts);
}

export async function importDocument(bytes:Buffer,root:string){
 const id=randomUUID(),stage=path.join(root,'media',`.document-${id}`),final=path.join(root,'media',id);
 mkdirSync(stage,{recursive:true,mode:0o700});
 try{
  writeFileSync(path.join(stage,'original'),bytes,{mode:0o400});
  let mime:'application/pdf'|'text/plain',filename:string;
  if(bytes.subarray(0,5).toString()==='%PDF-'){
   mime='application/pdf';filename='document.pdf';
   const source=path.join(stage,'original'),signal=AbortSignal.timeout(60000);
   const info=await run('pdfinfo',[source],{timeout:10000,maxBuffer:100000,signal});
   const pages=Number(/^Pages:\s+(\d+)/m.exec(info.stdout)?.[1]);
   if(!Number.isInteger(pages)||pages<1||pages>20||!/^Encrypted:\s+no/m.test(info.stdout))throw Error('INVALID_DOCUMENT');
   const rendered=[];
   for(let i=1;i<=pages;i++){
    const prefix=path.join(stage,`page-${i}`);
    await run('pdftoppm',['-f',String(i),'-l',String(i),'-singlefile','-scale-to','1600','-png',source,prefix],{timeout:15000,maxBuffer:100000,signal});
    const result=await sharp(`${prefix}.png`,{limitInputPixels:3000000}).flatten({background:'#fff'}).toColourspace('srgb').removeAlpha().jpeg({quality:88}).toBuffer({resolveWithObject:true});
    rendered.push({jpeg:result.data,width:result.info.width,height:result.info.height});
    rmSync(`${prefix}.png`);
   }
   writeFileSync(path.join(stage,filename),imageOnlyPdf(rendered),{mode:0o600});
  }else{
   mime='text/plain';filename='document.txt';
   if(bytes.length>2_000_000)throw Error('INVALID_DOCUMENT');
   let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('INVALID_DOCUMENT');}
   if(!text.trim()||Array.from(text).some(c=>c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c)))throw Error('INVALID_DOCUMENT');
   writeFileSync(path.join(stage,filename),text,{mode:0o600});
  }
  writeFileSync(path.join(stage,'manifest.json'),JSON.stringify({id,kind:'document',mime,filename,levels:[]}),{mode:0o600});
  renameSync(stage,final);return {id,kind:'document' as const,mime};
 }catch(error){rmSync(stage,{recursive:true,force:true});if(error instanceof Error&&error.message==='INVALID_DOCUMENT')throw error;throw Error('INVALID_DOCUMENT',{cause:error});}
}

export function documentDownloadHeaders(mime:string){return {'Content-Type':mime,'Content-Disposition':`attachment; filename="document.${mime==='application/pdf'?'pdf':'txt'}"`,'Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-Type-Options':'nosniff'};}

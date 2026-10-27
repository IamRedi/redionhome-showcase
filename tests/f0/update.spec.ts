import {test,expect,type Page} from '@playwright/test';
import {readFileSync,symlinkSync,renameSync} from 'node:fs';
import path from 'node:path';
const fixture=path.resolve('.test-data/f0');
function serve(dir:string){
  symlinkSync(dir,path.join(fixture,'switch'));
  renameSync(path.join(fixture,'switch'),path.resolve('f0-client'));
}
async function editor(page:Page){
  await page.getByTestId('brand-toggle').click();
  const admin=page.getByRole('button',{name:'Modaliteti admin',exact:true});
  if(await admin.getAttribute('aria-pressed')!=='true')await admin.click();
  await expect(page.locator('.world-loading')).toHaveCount(0);
  await page.getByRole('button',{name:'Objektet e dhomës'}).click();
  await page.getByRole('dialog').getByRole('button',{name:/Drita e ateliesë/}).click();
  await page.getByRole('button',{name:'Ndrysho objektin',exact:true}).click();
}
async function check(page:Page){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
async function ready(page:Page){await page.evaluate(()=>navigator.serviceWorker.ready.then(()=>undefined));}
async function waiting(page:Page){
  await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration())?.update();});
  await expect.poll(()=>page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
}
async function draft(page:Page){
  return page.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('redionhome-object-draft:')));
}
test('real legacy → F0 → successor → rollback preserves two tabs and drafts',async({page,context})=>{
  serve(path.join(fixture,'legacy'));
  page.on('dialog',d=>void d.accept());
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-f0-password-42');
  await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click();
  await ready(page);
  await editor(page);
  await page.getByLabel('Emri i objektit',{exact:true}).fill('Draft legacy i papërfunduar');
  const original=await draft(page);
  expect(original.length).toBe(1);
  const second=await context.newPage();
  second.on('dialog',d=>void d.accept());
  await second.goto('/');
  await ready(second);
  serve(path.resolve('dist'));
  await waiting(second);
  // Legacy has no update UI. Deliberate reload loads current network HTML;
  // no storage clearing or forced refresh is necessary.
  await page.reload();
  const build=JSON.parse(readFileSync('dist/build.json','utf8')).buildId;
  await expect(page.locator('[data-client-build]')).toHaveAttribute('data-client-build',build);
  expect(await draft(page)).toEqual(original);
  await editor(page);
  await page.getByRole('button',{name:'Rikupero draftin'}).click();
  await expect(page.getByLabel('Emri i objektit',{exact:true})).toHaveValue('Draft legacy i papërfunduar');
  await second.reload();
  await expect(second.locator('[data-client-build]')).toHaveAttribute('data-client-build',build);
  // Complete the initial activation deliberately, leaving the editor in tab 1.
  await expect(second.getByRole('button',{name:'Përditëso',exact:true})).toBeVisible();
  await expect(second.getByRole('button',{name:'Përditëso',exact:true})).toHaveClass(/glass-button/);
  await second.screenshot({path:'docs/f1/f1-update-mobile.png'});
  await Promise.all([second.waitForNavigation({waitUntil:'domcontentloaded'}),second.getByRole('button',{name:'Përditëso',exact:true}).click()]);
  await expect.poll(()=>second.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(false);
  const before=await draft(page);
  const next=JSON.parse(readFileSync(path.join(fixture,'next/build.json'),'utf8')).buildId;
  expect(next).not.toBe(build);
  serve(path.join(fixture,'next'));
  await check(second);
  await waiting(second);
  await expect(second.getByRole('button',{name:'Përditëso',exact:true})).toBeVisible();
  await second.getByRole('button',{name:'Përditëso',exact:true}).click();
  await expect(second.locator('[data-client-build]')).toHaveAttribute('data-client-build',next);
  await expect(page.locator('[data-client-build]')).toHaveAttribute('data-client-build',build);
  await expect(page.getByLabel('Emri i objektit',{exact:true})).toHaveValue('Draft legacy i papërfunduar');
  expect(await draft(page)).toEqual(before);
  // Close deliberately, update, recover. Editing is never auto-reloaded.
  await page.getByRole('dialog').getByRole('button',{name:'Mbyll panelin'}).click();
  await check(page);
  await page.getByRole('button',{name:'Përditëso',exact:true}).click();
  await expect(page.locator('[data-client-build]')).toHaveAttribute('data-client-build',next);
  await editor(page);
  await page.getByRole('button',{name:'Rikupero draftin'}).click();
  await expect(page.getByLabel('Emri i objektit',{exact:true})).toHaveValue('Draft legacy i papërfunduar');
  // Roll back while tab 1 is still editing the new version.
  serve(path.resolve('dist'));
  await check(second);await waiting(second);
  await second.getByRole('button',{name:'Përditëso',exact:true}).click();
  await expect(second.locator('[data-client-build]')).toHaveAttribute('data-client-build',build);
  await expect(page.locator('[data-client-build]')).toHaveAttribute('data-client-build',next);
  expect(await draft(page)).toEqual(before);
  const requests=await page.evaluate(async()=>{
    return (await Promise.all((await caches.keys()).map(async k=>(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)))).flat();
  });
  expect(requests.some(p=>p.startsWith('/api/')||p==='/build.json')).toBe(false);
  const retained=Object.keys(JSON.parse(readFileSync(path.join(fixture,'next/build.json'),'utf8')).assets).find(k=>k.endsWith('.js')&&k.startsWith('assets/'))!;
  expect((await second.request.get('/'+retained)).status()).toBe(200);
  expect((await second.request.get('/assets/missing-file.js')).status()).toBe(404);
  for(const resource of ['/','/sw.js','/build.json'])expect((await second.request.get(resource)).headers()['cache-control']).toBe('no-store');
  await second.screenshot({path:'test-results/f0-samsung-build.png'});
  await context.setOffline(true);
  expect(await page.evaluate(async()=>{try{await fetch('/api/v1/commands',{method:'POST',body:'{}'});return 'sent';}catch{return 'offline';}})).toBe('offline');
  await context.setOffline(false);
});

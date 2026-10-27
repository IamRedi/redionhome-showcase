import {test,expect,type Page} from '@playwright/test';

async function login(page:Page){
 await page.goto('/ai');await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click();await expect(page.getByLabel('Mesazhi për AI')).toBeVisible();
 // Every scenario begins without a persistent grant from a preceding owner test.
 await page.evaluate(async()=>{const p=await(await fetch('/api/v1/action-policy')).json();const r=await fetch('/api/v1/action-policy',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:p.version,mode:'advise',duration:'persistent',grants:[]})});if(!r.ok)throw Error('Synthetic policy reset failed');});
}
async function grant(page:Page,mode='auto'){
 await page.getByRole('button',{name:'Lejet',exact:true}).click();
 await page.getByLabel('Mënyra e lejes',{exact:true}).selectOption(mode);
 await page.getByLabel('Lejo Drita e ateliesë',{exact:true}).check();
 await page.getByRole('button',{name:'Ruaj lejet',exact:true}).click();await expect(page.getByText('Lejet u ruajtën.',{exact:true})).toBeVisible();
}

test('F2 voice request follows owner scope, saves an ambient and repeats its stored steps without a model',async({page},info)=>{
 const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/ai/chat'))requests.push(r.postData()??'');});
 await page.addInitScript(()=>Object.defineProperty(window,'SpeechRecognition',{value:class{
  onresult:((e:unknown)=>void)|null=null;onend:(()=>void)|null=null;
  start(){queueMicrotask(()=>{this.onresult?.({results:[[{transcript:'Ndiz dritën e ateliesë'}]]});this.onend?.();});}stop(){}
 }}));
 await login(page);await grant(page);await page.getByRole('button',{name:'Biseda',exact:true}).click();
 await page.getByRole('button',{name:'Fol shqip',exact:true}).click();await expect(page.getByLabel('Mesazhi për AI')).toHaveValue('Ndiz dritën e ateliesë');await page.getByRole('button',{name:'Dërgo te AI'}).click();
 await expect(page.getByRole('button',{name:'Komandat u konfirmuan',exact:true})).toBeVisible();expect(JSON.parse(requests[0]).channel).toBe('voice');
 await page.getByLabel(/Emri për ambientin/).fill(`Mbrëmje F2 ${info.project.name}`);await page.getByRole('button',{name:'Ruaj si ambient',exact:true}).click();await expect(page.getByRole('button',{name:'Ambienti u ruajt',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Ambiente',exact:true}).click();
 const activate=page.getByRole('button',{name:`Aktivizo Mbrëmje F2 ${info.project.name}`,exact:true});await expect(activate).toBeEnabled();await activate.click();await expect(page.getByRole('button',{name:'Ndalo ambientin'})).toHaveCount(0);
 await expect(page.locator('.action-center .run-result')).toContainText('Gjendja u konfirmua');expect(requests).toHaveLength(1);
 await page.screenshot({path:`docs/f2/ambients-${info.project.name}.png`});
 await page.reload();await page.getByRole('button',{name:'Ambiente',exact:true}).click();await expect(activate).toBeVisible();
 await page.getByRole('button',{name:'Lejet',exact:true}).click();await page.getByRole('button',{name:'Revoko lejet',exact:true}).click();await expect(page.getByText('Lejet u revokuan. Hapat e rinj do të refuzohen.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Ambiente',exact:true}).click();await expect(activate).toBeDisabled();
 await page.getByRole('button',{name:'Aktiviteti',exact:true}).click();await expect(page.locator('.activity-run').first()).toBeVisible();await page.locator('.activity-run').first().locator('summary').click();await expect(page.locator('.activity-run').first()).toContainText('Nisësi: owner');await page.screenshot({path:`docs/f2/activity-${info.project.name}.png`});expect(errors).toEqual([]);
});

test('F2 small-screen manual ambient capture persists without executing a device',async({page},info)=>{
 await page.setViewportSize({width:320,height:640});await page.emulateMedia({reducedMotion:'reduce'});
 const commands:string[]=[];page.on('request',r=>{if(/\/commands$|\/run$|\/execute$/.test(r.url()))commands.push(r.url());});
 await login(page);await page.getByRole('button',{name:'Ambiente',exact:true}).click();await page.getByText('Krijo ambient manualisht',{exact:true}).click();
 await page.getByLabel('Emri i ambientit',{exact:true}).fill(`Gjendja F2 ${info.project.name}`);await page.getByLabel('Përfshi Drita e ateliesë',{exact:true}).check();await page.getByRole('button',{name:'Ruaj gjendjen aktuale',exact:true}).click();await expect(page.getByText('Ambienti u ruajt. Ruajtja nuk aktivizon pajisje ose orare.',{exact:true})).toBeVisible();expect(commands).toEqual([]);
 await expect(page.getByRole('button',{name:`Aktivizo Gjendja F2 ${info.project.name}`,exact:true})).toBeDisabled();
 const card=page.locator('.ambient-card').filter({hasText:`Gjendja F2 ${info.project.name}`});await card.locator('summary').click();await card.getByRole('button',{name:'Ndrysho ambientin',exact:true}).click();
 await page.getByLabel('Emri i ambientit',{exact:true}).fill(`Gjendja F2 ${info.project.name} e ndryshuar`);await page.getByLabel('Veprimi: Drita e ateliesë',{exact:true}).selectOption('turn_off');await page.getByRole('button',{name:'Ruaj ambientin',exact:true}).click();
 await expect(page.getByRole('button',{name:`Aktivizo Gjendja F2 ${info.project.name} e ndryshuar`,exact:true})).toBeVisible();
 await page.getByRole('button',{name:`Favorit: Gjendja F2 ${info.project.name} e ndryshuar`,exact:true}).click();await expect(page.getByRole('button',{name:`Favorit: Gjendja F2 ${info.project.name} e ndryshuar`,exact:true})).toHaveAttribute('aria-pressed','true');expect(commands).toEqual([]);
 await expect.poll(()=>page.getByRole('dialog').evaluate(e=>e.scrollWidth-e.clientWidth)).toBe(0);
 await page.getByRole('button',{name:'Lejet',exact:true}).click();await expect(page.getByLabel('Mënyra e lejes',{exact:true})).toHaveValue('advise');await expect(page.getByLabel('Mënyra e lejes',{exact:true})).toBeInViewport();await page.screenshot({path:`docs/f2/permissions-small-${info.project.name}.png`});
});

test('F2 response loss retries the identical request and does not repeat automatic actions',async({page})=>{
 await login(page);await grant(page);await page.getByRole('button',{name:'Biseda',exact:true}).click();
 const before=await page.evaluate(async()=>await(await fetch('/api/v1/ai/status')).json());let loseResponse=true;const ids:string[]=[];
 await page.route('**/api/v1/ai/chat',async route=>{ids.push(route.request().postDataJSON().requestId);const response=await route.fetch();if(loseResponse){loseResponse=false;await route.abort('failed');}else await route.fulfill({response});});
 await page.getByLabel('Mesazhi për AI').fill('Ndiz dritën e ateliesë');await page.getByRole('button',{name:'Dërgo te AI'}).click();await expect(page.getByRole('alert')).toContainText('Mesazhi juaj mbeti');
 await page.getByRole('button',{name:'Dërgo te AI'}).click();await expect(page.getByRole('button',{name:'Komandat u konfirmuan',exact:true})).toBeVisible();expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
 const after=await page.evaluate(async()=>await(await fetch('/api/v1/ai/status')).json());expect(after.requestsToday-before.requestsToday).toBe(1);
 const runs=await page.evaluate(async()=>await(await fetch('/api/v1/action-runs')).json());expect(runs.filter((r:{requestId:string})=>r.requestId===ids[0])).toHaveLength(1);
});

test('F2 Stop aborts delayed planning without sending a device command',async({page})=>{
 let release!:()=>void;const held=new Promise<void>(r=>{release=r;});const dispatches:string[]=[];
 await page.route('**/api/v1/ai/chat',async route=>{await held;await route.fulfill({status:409,json:{error:'AI_STOPPED'}}).catch(()=>undefined);});
 page.on('request',r=>{if(/\/commands$|\/run$|\/execute$/.test(r.url()))dispatches.push(r.url());});
 await login(page);await page.getByLabel('Mesazhi për AI').fill('Ndiz dritën e ateliesë');await page.getByRole('button',{name:'Dërgo te AI'}).click();await expect(page.getByRole('button',{name:'Ndalo',exact:true})).toBeVisible();await page.getByRole('button',{name:'Ndalo',exact:true}).click();await expect(page.getByRole('button',{name:'Ndalo',exact:true})).toHaveCount(0);release();await expect(page.getByLabel('Mesazhi për AI')).toHaveValue('Ndiz dritën e ateliesë');expect(dispatches).toEqual([]);
});

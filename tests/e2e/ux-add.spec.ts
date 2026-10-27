import {test,expect} from '@playwright/test';
import type {Home} from '../../shared/model.ts';

test('one add flow places a discovered light and controls it through the capability UI',async({page},info)=>{
 await page.goto('/');
 await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');
 await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click(); await page.getByTestId('brand-toggle').click();
 await page.getByRole('button',{name:'Modaliteti admin'}).click();
 await expect(page.getByRole('heading',{name:'Atelie.'})).toBeVisible();
 await expect(page.locator('.world-loading')).toHaveCount(0);
 const home=await page.evaluate(async()=>await(await fetch('/api/v1/home')).json()) as Home;
 let light='off',saved=false,submitted:Record<string,unknown>|null=null;
 await page.route('**/api/v1/ha',route=>route.fulfill({json:{status:'CONNECTED',configured:true,error:null}}));
 await page.route('**/api/v1/ha/inventory',route=>route.fulfill({json:[{entityId:'light.kitchen',name:'Drita prove',domain:'light',source:'home-assistant',state:'off',supported:true,capabilities:['power','brightness']},{entityId:'lock.front',name:'Door lock',domain:'lock',state:'unavailable',supported:false,capabilities:[]}]}));
 await page.route('**/api/v1/ha/bindings',route=>route.fulfill({json:[]}));
 const catalog={devices:[{provider:'home-assistant',externalId:'light.kitchen',name:'Drita prove',category:'light',capabilities:['power','brightness'],commandCapabilities:['power','brightness'],state:'off',availability:'online',values:{brightness:50},observedAt:'2026-10-15T10:00:00Z',room:null,objectId:null,duplicateCandidate:false,reason:null,lastSeenAt:'2026-10-15 10:00:00'},{provider:'home-assistant',externalId:'lock.front',name:'Door lock',category:'lock',capabilities:['lock'],commandCapabilities:[],state:'locked',availability:'online',values:{value:'locked'},observedAt:null,room:null,objectId:null,duplicateCandidate:false,reason:null,lastSeenAt:'2026-10-15 10:00:00'}],providers:[],totals:{devices:2,online:2,unavailable:0,controllable:1,linked:0,duplicateCandidates:0}};
 await page.route('**/api/v1/unified-devices',route=>route.fulfill({json:catalog}));
 await page.route('**/api/v1/unified-devices/discover',route=>route.fulfill({json:catalog}));
 await page.route('**/api/v1/ha/add',route=>{submitted=route.request().postDataJSON() as Record<string,unknown>;saved=true;const objectId='synthetic-light',bindingId='ha-synthetic-light';const next={...home,revision:home.revision+1,objects:[...home.objects,{id:objectId,roomId:home.scenes[0].roomId,name:'Drita prove',description:'',actions:[{type:'device',bindingId}],provider:{identity:objectId,active:'home-assistant',status:'configured'}}],scenes:home.scenes.map((s,i)=>i===0?{...s,hotspots:[...s.hotspots,{id:'synthetic-light-pin',objectId,position:(submitted as Record<string,unknown>).position}]}:s)};return route.fulfill({status:201,json:{home:next,objectId,controlEnabled:true}});});
 await page.route('**/api/v1/devices',route=>saved?route.fulfill({json:{mode:'mock',connection:'online',entities:[{bindingId:'ha-synthetic-light',entityId:'light.kitchen',name:'Drita prove',state:light,source:'home-assistant',controlEnabled:true,capabilities:['power','brightness'],commandCapabilities:['power','brightness'],brightness:50}]}}):route.continue());
 await page.route('**/api/v1/commands',route=>{const body=route.request().postDataJSON() as {action:string;confirmEntityId:string};expect(body.confirmEntityId).toBe('light.kitchen');light=body.action==='turn_off'?'off':'on';return route.fulfill({json:{mode:'mock',connection:'online',entities:[{bindingId:'ha-synthetic-light',entityId:'light.kitchen',name:'Drita prove',state:light,source:'home-assistant',controlEnabled:true,capabilities:['power','brightness'],commandCapabilities:['power','brightness'],brightness:50}]}});});
 await page.getByRole('button',{name:'+ Shto'}).click();
 await page.screenshot({path:`docs/m4b/ux-add-menu-${info.project.name}.jpg`,type:'jpeg',quality:85});
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:/Pajisje Smart/}).click();
 await dialog.getByRole('button',{name:/Katalogu universal/}).click();
 await expect(dialog.getByRole('button',{name:/Drita prove/})).toBeVisible();
 await dialog.getByRole('button',{name:/Drita prove/}).click();
 await expect(dialog.getByRole('option',{name:/Eksploro studion/})).toHaveCount(0);
 await page.screenshot({path:`docs/m4b/ux-place-${info.project.name}.jpg`,type:'jpeg',quality:85});
 await dialog.getByRole('button',{name:'Prek vendin në panoramë'}).click();
 await expect(dialog).not.toBeVisible();
 const box=await page.locator('canvas').boundingBox();expect(box).not.toBeNull();
 await page.mouse.click(box!.x+box!.width*.58,box!.y+box!.height*.40);
 await expect(dialog).toBeVisible();
 await dialog.getByRole('checkbox',{name:/Konfirmoj se kjo pajisje/}).check();
 await dialog.getByRole('button',{name:'Ruaj pajisjen'}).click();
 expect(submitted).toMatchObject({entityId:'light.kitchen',sceneId:home.scenes[0].id,confirmSamePhysicalDevice:true,enableControl:true,moveExisting:false});
 await expect(page.getByRole('dialog')).toContainText('Drita prove');
 const toggle=page.getByRole('switch',{name:/Drita prove/});await expect(toggle).toBeEnabled();await expect(toggle).toHaveAttribute('aria-checked','false');
 await toggle.click();await expect(toggle).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'Mbyll panelin'}).click();
 await page.getByTestId('brand-toggle').click();
 await expect(page.locator('.scene-shade')).toHaveCSS('opacity','0');
 await expect(page.locator('.chrome').first()).toHaveCSS('opacity','0');
 // F1: the logo hides menus only; save feedback must remain visible, like icons.
 await expect(page.locator('.toast')).toBeVisible();
 await expect(page.locator('.toast')).toContainText('Pajisja u shtua');
 await page.screenshot({path:`docs/m4b/ux-clean-${info.project.name}.jpg`,type:'jpeg',quality:85});
});

test('unified catalogue stays compact and honest across device categories',async({page},info)=>{
 await page.goto('/');
 await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');
 await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click(); await page.getByTestId('brand-toggle').click();
 await page.getByRole('button',{name:'Modaliteti admin'}).click();
 await expect(page.getByRole('heading',{name:'Atelie.'})).toBeVisible();
 const devices=[
  {provider:'home-assistant',externalId:'light.synthetic',name:'Drita e studios',category:'light',capabilities:['power','brightness'],commandCapabilities:['power','brightness'],state:'off',availability:'online',values:{brightness:45},observedAt:null,room:null,objectId:'light',duplicateCandidate:false,reason:null,lastSeenAt:'2026-10-15 10:00:00'},
  {provider:'home-assistant',externalId:'sensor.temperature',name:'Temperatura',category:'sensor',capabilities:['telemetry','temperature'],commandCapabilities:[],state:'21.4',availability:'online',values:{value:21.4,unit_of_measurement:'°C'},observedAt:null,room:null,objectId:null,duplicateCandidate:false,reason:null,lastSeenAt:'2026-10-15 10:00:00'},
  {provider:'tuya',externalId:'synthetic-plug',name:'Priza e tavolinës',category:'outlet',capabilities:['power'],commandCapabilities:[],state:'unavailable',availability:'offline',values:{},observedAt:null,room:null,objectId:null,duplicateCandidate:false,reason:'PROVIDER_OFFLINE',lastSeenAt:'2026-10-15 10:00:00'},
  {provider:'smartthings',externalId:'synthetic-duplicate',name:'Drita e studios',category:'light',capabilities:['power'],commandCapabilities:[],state:'off',availability:'online',values:{},observedAt:null,room:null,objectId:null,duplicateCandidate:true,reason:null,lastSeenAt:'2026-10-15 10:00:00'},
 ];
 const report={devices,providers:[{provider:'home-assistant',status:'connected',discovered:2,reason:null},{provider:'smartthings',status:'connected',discovered:1,reason:null},{provider:'tuya',status:'connected',discovered:1,reason:null}],totals:{devices:4,online:3,unavailable:1,controllable:1,linked:1,duplicateCandidates:1}};
 await page.route('**/api/v1/unified-devices',route=>route.fulfill({json:report}));
 await page.route('**/api/v1/unified-devices/discover',route=>route.fulfill({json:report}));
 await page.getByRole('button',{name:'Settings · Integrations'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Integrations'})).toBeVisible();
 await expect(dialog.getByRole('heading',{name:'Katalogu universal'})).toBeVisible();
 await expect(dialog).toContainText('Temperatura');await expect(dialog).toContainText('Kontrollo dublikatën');
 await dialog.getByRole('button',{name:'Pa lidhje'}).click();
 await expect(dialog).toContainText('Priza e tavolinës');await expect(dialog).not.toContainText('Temperatura');
 await page.screenshot({path:`docs/unified-device/catalog-${info.project.name}.jpg`,type:'jpeg',quality:88});
});

import {test,expect,type Page} from '@playwright/test';
import type {ProductReport} from '../../shared/product-integrations.ts';

const piano:ProductReport={objectId:'artwork',product:'piano-core',name:'Piano Core',status:'degraded',identityVerified:true,readings:[{label:'Aplikacioni',value:'READY',sourceObservedAt:null},{label:'MIDI',value:'DISCONNECTED',sourceObservedAt:null},{label:'Dalja MIDI',value:'E padisponueshme',sourceObservedAt:null}],presets:[],launchUrl:'http://piano.fixture:8788/',launchLabel:'Hap Piano Core',message:'Hap ndërfaqen ekzistuese. Hapja nuk nis playback ose praktikë.',receivedAt:'2026-10-26T12:00:00Z',commandSupported:false,physicalResult:'NOT_VERIFIED',unsupportedMetrics:['Kohë praktike','Energji','Kosto']};
async function openCard(page:Page){
 await page.route('**/api/v1/home',async route=>{const response=await route.fetch(),h=await response.json(),o=h.objects.find((x:{id:string})=>x.id==='artwork');o.kind='piano';o.actions=[{type:'integration',adapterId:'piano-core'}];h.scenes[0].hotspots.find((x:{objectId:string})=>x.objectId==='artwork').position={yaw:0,pitch:0};await route.fulfill({response,json:h});});
 await page.goto('/');await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click();
 await page.getByTestId('brand-toggle').click();await expect(page.locator('.world-loading')).toHaveCount(0);await page.locator('.world-pin').filter({hasText:'Brenda ateliesë'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
}
test('F3 opens the existing Piano UI after an intentional tap and keeps playback claims separate',async({page,context},info)=>{
 const commands:string[]=[],opens:unknown[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/commands'))commands.push(r.url());});
 await page.route('**/api/v1/product-integrations/artwork',r=>r.fulfill({json:piano}));
 await page.route('**/api/v1/product-integrations/artwork/open',r=>{opens.push(r.request().postDataJSON());return r.fulfill({json:{url:piano.launchUrl,result:'open_requested',processStarted:false}});});
 await context.route('http://piano.fixture:8788/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic existing Piano UI</title><h1>Piano Core fixture</h1>'}));
 await openCard(page);const section=page.getByRole('region',{name:'Lidhja e produktit'});
 await expect(section).toContainText('Me kufizime');await expect(section).toContainText('Shkëputur');await expect(section).toContainText('nuk nis playback');
 expect(opens).toEqual([]);const popupPromise=page.waitForEvent('popup');await section.getByRole('link',{name:'Hap Piano Core'}).click();const popup=await popupPromise;await expect(popup.getByRole('heading',{name:'Piano Core fixture'})).toBeVisible();await popup.close();
 await expect.poll(()=>opens.length).toBe(1);expect(opens[0]).toHaveProperty('requestId');expect(commands).toEqual([]);
 await section.locator('summary').click();await expect(section).toContainText('Koha e ndryshimit në burim nuk raportohet');await expect(section).toContainText('Komanda fizike nga kjo kartë: të bllokuara');
 await expect.poll(()=>page.getByRole('dialog').evaluate(e=>e.scrollWidth-e.clientWidth)).toBe(0);await page.screenshot({path:`docs/f3/piano-${info.project.name}.png`});expect(errors).toEqual([]);
});
test('F3 small-screen identity failure offers refresh and no launch or physical controls',async({page},info)=>{
 await page.setViewportSize({width:320,height:640});await page.emulateMedia({reducedMotion:'reduce'});let failed=true;
 await page.route('**/api/v1/product-integrations/artwork',r=>r.fulfill({json:failed?{...piano,status:'identity_mismatch',identityVerified:false,launchUrl:null,readings:[],message:'Identiteti i Piano Core ndryshoi. Kontrolloni lidhjen.'}:piano}));
 await openCard(page);const section=page.getByRole('region',{name:'Lidhja e produktit'});await expect(section).toContainText('Identitet i ndryshuar');await expect(section.getByRole('link')).toHaveCount(0);await expect(section.getByRole('switch')).toHaveCount(0);
 failed=false;await section.getByRole('button',{name:'Rilexo gjendjen e produktit'}).click();await expect(section.getByRole('link',{name:'Hap Piano Core'})).toBeVisible();
 await expect.poll(()=>page.getByRole('dialog').evaluate(e=>e.scrollWidth-e.clientWidth)).toBe(0);await page.screenshot({path:`docs/f3/piano-small-${info.project.name}.png`});
});
test('F3 read error is visible and retry recovers without closing the object card',async({page})=>{
 let failed=true;await page.route('**/api/v1/product-integrations/artwork',r=>failed?r.fulfill({status:503,json:{error:'PRODUCT_CONFIG_INVALID'}}):r.fulfill({json:piano}));
 await openCard(page);const section=page.getByRole('region',{name:'Lidhja e produktit'});await expect(section.getByRole('alert')).toContainText('Konfigurimi privat');failed=false;await section.getByRole('button',{name:'Rilexo gjendjen e produktit'}).click();await expect(section.getByRole('link',{name:'Hap Piano Core'})).toBeVisible();await expect(section.getByRole('alert')).toHaveCount(0);
});

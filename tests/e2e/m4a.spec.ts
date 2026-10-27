import {test,expect} from '@playwright/test';
import type {Home} from '../../shared/model.ts';

test('owner sees blocked direct providers and can add a read-only HA device from the phone list',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');
 await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click(); await page.getByTestId('brand-toggle').click();
 await page.getByRole('button',{name:'Modaliteti admin'}).click();
 await expect(page.getByRole('button',{name:'Settings · Integrations'})).toBeVisible();
 const initialHome=await page.evaluate(async()=>{const response=await fetch('/api/v1/home');if(!response.ok)throw Error('HOME_NOT_READY');return response.json();}) as Home;
 await page.getByRole('button',{name:'Settings · Integrations'}).click();
 const catalog=page.getByRole('dialog');
 await catalog.getByRole('button',{name:/SmartThings · lidhje direkte/}).click();
 await expect(catalog).toContainText('AUTH_BLOCKED');
 await expect(catalog.getByRole('button',{name:/Connect Account/})).toBeDisabled();
 await expect(catalog.getByRole('button',{name:'Discover'})).toBeDisabled();
 await catalog.getByRole('button',{name:'Kthehu te Integrations'}).click();
 await catalog.getByRole('button',{name:/Smart Life\/Tuya · lidhje direkte/}).click();
 await expect(catalog).toContainText('AUTH_BLOCKED');
 await expect(catalog.getByRole('button',{name:'Discover · READ-ONLY'})).toBeDisabled();
 await catalog.getByRole('button',{name:'Kthehu te Integrations'}).click();
 await catalog.getByRole('button',{name:'Shiko pajisjet · Home Assistant'}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog).toContainText('Home Assistant pa lidhje');
 await expect(dialog).toContainText('Kredenciali mbahet vetëm në server');
 await dialog.getByLabel('Adresa Home Assistant').fill('http://127.0.0.1:8123/');
 await dialog.getByRole('button',{name:'Lidh Home Assistant'}).click();
 await expect(dialog.getByRole('alert')).toContainText('nuk është në listën e lejuar');
 await expect(dialog).not.toContainText('synthetic-ha-token');
 await dialog.getByRole('button',{name:'Mbyll panelin'}).click();

 let bindingRows:{bindingId:string;objectId:string;entityId:string}[]=[];
 await page.route('**/api/v1/ha',route=>route.fulfill({json:{status:'CONNECTED',configured:true,origin:'http://127.0.0.1:8123',error:null}}));
 await page.route('**/api/v1/ha/bindings',route=>route.fulfill({json:bindingRows}));
 await page.route('**/api/v1/ha/inventory',route=>route.fulfill({json:[
  {entityId:'light.demo_lamp',name:'Demo Lamp',domain:'light',source:'home-assistant',state:'on',observedAt:'2026-10-13T10:00:00Z',supported:true,capabilities:['power']},
  {entityId:'sensor.plug_power',name:'Priza power',domain:'sensor',source:'home-assistant',state:'unavailable',rawState:'17.2',observedAt:null,supported:false,capabilities:[]}
 ]}));
 let submitted:{objectId:string;entityId:string;confirmSamePhysicalDevice:boolean;expectedRevision:number}|null=null;
 await page.route('**/api/v1/ha/bind',route=>{
  const body=route.request().postDataJSON() as {objectId:string;entityId:string;confirmSamePhysicalDevice:boolean;expectedRevision:number};
  submitted=body;bindingRows=[{bindingId:'ha-test-binding',objectId:body.objectId,entityId:body.entityId}];
  const next={...initialHome,revision:initialHome.revision+1,objects:initialHome.objects.map(o=>o.id===body.objectId?{...o,provider:{identity:o.id,active:'home-assistant' as const,status:'configured' as const},actions:[...o.actions,{type:'device' as const,bindingId:'ha-test-binding'}]}:o)};
  return route.fulfill({status:201,json:next});
 });
 await catalog.getByRole('button',{name:'Shiko pajisjet · Home Assistant'}).click();
 await dialog.getByLabel('Kërko pajisje').fill('Demo Lamp');
 await dialog.getByRole('button',{name:/Demo Lamp.*light.demo_lamp/}).click();
 await expect(dialog.getByRole('button',{name:'Shto te objekti'})).toBeDisabled();
 await dialog.getByLabel('Zgjidh objektin në panoramë').selectOption({index:1});
 await dialog.getByLabel(/Konfirmoj se kjo pajisje/).check();
 await expect(dialog.getByRole('button',{name:'Shto te objekti'})).toBeEnabled();
 await dialog.getByRole('button',{name:'Shto te objekti'}).click();
 await expect(dialog.getByRole('button',{name:/Demo Lamp.*E lidhur me:/})).toBeVisible();
 expect(submitted).toMatchObject({entityId:'light.demo_lamp',confirmSamePhysicalDevice:true,expectedRevision:initialHome.revision});
 await dialog.getByRole('button',{name:/Të tjera \(1\)/}).click();
 await expect(dialog.getByRole('button',{name:/Priza power.*17.2/})).toBeVisible();
});

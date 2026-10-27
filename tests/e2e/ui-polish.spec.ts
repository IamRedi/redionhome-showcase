import {test,expect,type Page} from '@playwright/test';

async function login(page:Page,path='/ai'){
  await page.goto(path);
  await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');
  await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click();
}

test('AI request failure preserves the message and retry excludes the failed turn',async({page})=>{
  const requests:{history:unknown[]}[]=[];
  let fail=true;
  await page.route('**/api/v1/ai/chat',async route=>{
    requests.push(route.request().postDataJSON());
    if(fail){fail=false;await route.fulfill({status:503,json:{error:{code:'AI_UNAVAILABLE',message:'Provë pa lidhje'}}});}
    else await route.continue();
  });
  await login(page);
  const composer=page.getByLabel('Mesazhi për AI');
  await composer.fill('Përshëndetje nga testi i rikthimit');
  await page.getByRole('button',{name:'Dërgo te AI'}).click();
  await expect(page.getByRole('alert')).toContainText('Mesazhi juaj mbeti');
  await expect(composer).toHaveValue('Përshëndetje nga testi i rikthimit');
  await expect(page.locator('.ai-message.user')).toHaveCount(0);
  await page.getByRole('button',{name:'Dërgo te AI'}).click();
  await expect(page.locator('.ai-message.assistant')).toContainText('Përgjigje prove');
  await expect(composer).toHaveValue('');
  expect(requests).toHaveLength(2);
  expect(requests.map(request=>request.history)).toEqual([[],[]]);
});

test('microphone stops deliberately, reports start failure and releases on close',async({page})=>{
  await page.addInitScript(()=>{
    let fail=false,stops=0;
    Object.defineProperty(window,'SpeechRecognition',{value:class{
      start(){if(fail)throw Error('Microphone unavailable');}
      stop(){stops++;}
    }});
    Object.defineProperty(window,'microphoneTest',{value:{fail:()=>{fail=true;},stops:()=>stops}});
  });
  await login(page,'/');
  await page.getByRole('button',{name:'R AI',exact:true}).click();
  await page.getByRole('button',{name:'Fol shqip',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Po dëgjoj');
  await page.getByRole('button',{name:'Ndalo dëgjimin'}).click();
  await expect(page.getByRole('button',{name:'Fol shqip',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.evaluate(()=>{(window as unknown as {microphoneTest:{fail:()=>void}}).microphoneTest.fail();});
  await page.getByRole('button',{name:'Fol shqip',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Mikrofoni nuk u hap');
  await expect(page.getByRole('button',{name:'Fol shqip',exact:true})).toHaveAttribute('aria-pressed','false');
  const before=await page.evaluate(()=>(window as unknown as {microphoneTest:{stops:()=>number}}).microphoneTest.stops());
  await page.getByRole('button',{name:'Mbyll panelin'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {microphoneTest:{stops:()=>number}}).microphoneTest.stops())).toBeGreaterThan(before);
});

test('small-screen wizard keeps steps on one row and starts each section at the top',async({page},info)=>{
  await page.setViewportSize({width:320,height:640});
  await page.emulateMedia({reducedMotion:'reduce'});
  await login(page,'/');
  await page.getByTestId('brand-toggle').click();
  await page.getByRole('button',{name:'Modaliteti admin',exact:true}).click();
  await page.getByRole('button',{name:'+ Shto',exact:true}).click();
  await page.getByRole('button',{name:/Objekt \/ Foto \/ Video/}).click();
  const steps=page.getByRole('navigation',{name:'Hapat e objektit'});
  const bounds=await steps.getByRole('button').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().toJSON()));
  expect(new Set(bounds.map(rect=>rect.top)).size).toBe(1);
  expect(bounds.every(rect=>rect.width>=44&&rect.height>=44)).toBe(true);
  const dialog=page.getByRole('dialog');
  await expect.poll(()=>dialog.evaluate(e=>e.scrollWidth-e.clientWidth)).toBe(0);
  await page.getByLabel('Emri i objektit',{exact:true}).fill('Objekt prove në ekran të vogël');
  await page.getByRole('button',{name:'Vazhdo',exact:true}).click();
  await expect(steps.getByRole('button',{name:'2 · Pozicioni',exact:true})).toHaveAttribute('aria-current','step');
  await expect.poll(()=>dialog.evaluate(e=>e.scrollTop)).toBe(0);
  await expect(page.getByRole('button',{name:'Mbyll panelin'})).toBeInViewport();
  await page.screenshot({path:`docs/f1/polish-wizard-${info.project.name}.png`});
});

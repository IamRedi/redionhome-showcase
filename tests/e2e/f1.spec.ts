import {test,expect,type Page} from '@playwright/test';

async function login(page:Page,path='/'){
  await page.goto(path);
  await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');
  await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click();
}
test('F1 eye, menus, card, R AI and real fullscreen remain independent',async({page},info)=>{
  const errors:string[]=[],commands:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/commands'))commands.push(r.url());});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/v1/home',async route=>{
    const response=await route.fetch(),home=await response.json();
    home.scenes[0].hotspots.find((h:{objectId:string})=>h.objectId==='artwork').position={yaw:0,pitch:0};
    await route.fulfill({response,json:home});
  });
  await login(page);
  const logo=page.getByTestId('brand-toggle');
  await logo.click();
  await expect(page.locator('.world-loading')).toHaveCount(0);
  const pin=page.locator('.world-pin').filter({hasText:'Brenda ateliesë'});
  await expect(pin).toBeVisible();
  await expect(page.locator('.view-controls button')).toHaveCount(0);
  await expect(page.locator('.compass')).toBeVisible();
  await expect(page.getByRole('button',{name:'Ekran i plotë',exact:true})).toHaveCount(1);
  for(const fullscreen of [false,true]){
    if(fullscreen){
      await page.getByRole('button',{name:'Ekran i plotë',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.tagName)).toBe('HTML');
    }
    await expect(page.getByRole('button',{name:'Fshih hotspot-et'})).toHaveAttribute('aria-pressed','true');
    await logo.click();
    await expect(page.getByRole('navigation',{name:'Mjetet e hapësirës'})).toBeHidden();
    await expect(pin).toBeVisible();
    await pin.click();
    await expect(page.getByRole('dialog')).toContainText('Brenda ateliesë');
    await page.getByRole('dialog').getByRole('button',{name:'R AI',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Asistenti AI'})).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByLabel('Mesazhi për AI')).toBeEditable();
    await page.screenshot({path:`docs/f1/f1-ai-${info.project.name}${fullscreen?'-fullscreen':''}.png`});
    await page.getByRole('button',{name:'Mbyll panelin'}).click();
    await expect(page.getByRole('dialog')).toContainText('Brenda ateliesë');
    await page.getByRole('button',{name:'Mbyll panelin'}).click();
    await expect(pin).toBeVisible();
    await logo.click();
    await page.getByRole('button',{name:'Fshih hotspot-et'}).click();
    await expect(pin).toBeHidden();
    await logo.click();
    await expect(pin).toBeHidden();
    await page.getByRole('button',{name:'R AI',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Asistenti AI'})).toBeVisible();
    await page.getByRole('button',{name:'Mbyll panelin'}).click();
    await expect(pin).toBeHidden();
    await logo.click();
    if(fullscreen){
      await page.getByRole('button',{name:'Dil nga ekrani i plotë',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
      await expect(pin).toBeHidden();
    }
    await page.getByRole('button',{name:'Modaliteti admin',exact:true}).click();
    await expect(pin).toBeHidden();
    await page.getByRole('button',{name:'Modaliteti admin',exact:true}).click();
    await expect(pin).toBeHidden();
    await page.getByRole('button',{name:'Shfaq hotspot-et'}).click();
  }
  await page.getByRole('button',{name:'Objektet e dhomës'}).click();
  await expect(page.getByRole('button',{name:'Shtoni ose ndryshoni objekte'})).toHaveCount(0);
  await page.getByRole('button',{name:'Mbyll panelin'}).click();
  await logo.click();
  await page.screenshot({path:`docs/f1/f1-clean-${info.project.name}.png`});
  expect(commands).toEqual([]);
  expect(errors).toEqual([]);
});

test('F1 wizard filters category fields and existing edit survives R AI and saves without rebinding',async({page},info)=>{
  await login(page);
  await page.getByTestId('brand-toggle').click();
  await page.getByRole('button',{name:'Modaliteti admin',exact:true}).click();
  await page.getByRole('button',{name:'Edit me prekje'}).click();
  for(const name of ['＋ Objekt i ri','Mbarova']){
    const button=page.getByRole('button',{name,exact:true});
    await expect(button).toBeVisible();
    // Check rendered contrast, including the worst-case white surface below glass.
    const contrast=await button.evaluate(element=>{
      const style=getComputedStyle(element);
      const rgb=(value:string)=>value.match(/[\d.]+/g)!.map(Number);
      const fg=rgb(style.color),bg=rgb(style.backgroundColor),alpha=bg[3]??1;
      const luminance=(values:number[])=>values.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const a=luminance(fg),b=luminance(bg.slice(0,3).map(v=>v*alpha+255*(1-alpha)));
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await page.screenshot({path:`docs/f1/f1-edit-controls-${info.project.name}.png`});
  await page.getByRole('button',{name:'Mbarova',exact:true}).click();
  await page.getByRole('button',{name:'+ Shto',exact:true}).click();
  await page.getByRole('button',{name:/Objekt \/ Foto \/ Video/}).click();
  await page.getByLabel('Emri i objektit',{exact:true}).fill('Draft F1');
  await page.getByLabel('Lloji i ikonës').selectOption('light');
  await page.getByRole('button',{name:'3 · Përmbajtja',exact:true}).click();
  await expect(page.getByLabel('Demonstrim virtual')).toHaveCount(0);
  await expect(page.getByLabel('Shto video MP4')).toHaveCount(0);
  await page.getByRole('button',{name:'1 · Objekti',exact:true}).click();
  await expect(page.getByLabel('Emri i objektit',{exact:true})).toHaveValue('Draft F1');
  await page.getByLabel('Lloji i ikonës').selectOption('piano');
  await page.getByRole('button',{name:'3 · Përmbajtja',exact:true}).click();
  await page.getByText('Prezantim & veprime virtuale',{exact:true}).click();
  expect(await page.getByLabel('Demonstrim virtual').locator('option').allTextContents()).toEqual(['Pa simulim','Piano · LED virtual']);
  await page.getByRole('dialog').getByRole('button',{name:'R AI',exact:true}).click();
  await page.getByRole('button',{name:'Mbyll panelin'}).click();
  await expect(page.getByRole('button',{name:'3 · Përmbajtja',exact:true})).toHaveAttribute('aria-current','step');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Mbyll panelin'}).click();
  await page.getByRole('button',{name:'Objektet e dhomës'}).click();
  await page.getByRole('dialog').getByRole('button',{name:/Drita e ateliesë/}).click();
  await page.getByRole('button',{name:'Ndrysho objektin',exact:true}).click();
  const before=await page.evaluate(async()=>await(await fetch('/api/v1/home')).json());
  await page.getByLabel('Emri i objektit',{exact:true}).fill(`Drita F1 ${info.project.name}`);
  await page.getByRole('dialog').getByRole('button',{name:'R AI',exact:true}).click();
  await page.getByRole('button',{name:'Mbyll panelin'}).click();
  await expect(page.getByLabel('Emri i objektit',{exact:true})).toHaveValue(`Drita F1 ${info.project.name}`);
  await page.screenshot({path:`docs/f1/f1-editor-${info.project.name}.png`});
  await page.getByRole('button',{name:'Ruaj ndryshimet',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after=await page.evaluate(async()=>await(await fetch('/api/v1/home')).json());
  const light=after.objects.find((o:{id:string})=>o.id==='light');
  expect(light).toEqual({...before.objects.find((o:{id:string})=>o.id==='light'),name:`Drita F1 ${info.project.name}`});
  expect(after.revision).toBe(before.revision+1);
  await page.evaluate(async(revision)=>{const h=await(await fetch('/api/v1/home')).json();const r=await fetch('/api/v1/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,expectedRevision:h.revision})});if(!r.ok)throw Error('F1 fixture restore failed');},before.revision);
});

test('F1 /ai authenticates and answers using the existing assistant without panorama or WebGL',async({page},info)=>{
  const requested:string[]=[],errors:string[]=[];
  page.on('request',r=>requested.push(r.url()));
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){
      if(type.includes('webgl'))throw Error('Standalone AI initialized WebGL');
      return Reflect.apply(original,this,[type,...args]);
    } as typeof original;
  });
  await login(page,'/ai');
  await expect(page.getByRole('dialog',{name:'Asistenti AI'})).toBeVisible();
  await expect(page.getByText('AI aktive',{exact:true})).toBeVisible();
  await page.getByLabel('Mesazhi për AI').fill('Ku është drita?');
  await page.getByRole('button',{name:'Dërgo te AI'}).click();
  await expect(page.getByText('Përgjigje prove: Ku është drita?')).toBeVisible();
  await page.screenshot({path:`docs/f1/f1-ai-direct-${info.project.name}.png`});
  expect(requested.filter(url=>/\/assets\/App-|\/media\/|\/commands$/.test(url))).toEqual([]);
  await expect(page.locator('canvas,.panorama')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('F1 shelf, light, TV and link complete create, preview, save, reload and edit',async({page})=>{
  test.setTimeout(120000);
  const commands:string[]=[];
  page.on('request',r=>{if(r.url().endsWith('/commands'))commands.push(r.url());});
  await login(page);
  await page.getByTestId('brand-toggle').click();
  await page.getByRole('button',{name:'Modaliteti admin',exact:true}).click();
  await expect(page.locator('.world-loading')).toHaveCount(0);
  const original=await page.evaluate(async()=>await(await fetch('/api/v1/home')).json());
  for(const kind of ['shelf','light','tv','product']){
    await page.getByRole('button',{name:'+ Shto',exact:true}).click();
    await page.getByRole('button',{name:/Objekt \/ Foto \/ Video/}).click();
    await page.getByLabel('Emri i objektit',{exact:true}).fill(`F1 ${kind}`);
    await page.getByLabel('Lloji i ikonës').selectOption(kind);
    await page.getByRole('button',{name:'2 · Pozicioni',exact:true}).click();
    await page.getByRole('button',{name:'Zgjidh pozicionin në panoramë'}).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await page.locator('canvas').click({position:{x:180,y:240}});
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button',{name:'3 · Përmbajtja',exact:true}).click();
    if(kind==='product'){
      await page.getByText('Prezantim & veprime virtuale',{exact:true}).click();
      await page.getByLabel('Faqja zyrtare HTTPS',{exact:true}).fill('https://example.com/f1');
    }else{
      await expect(page.getByLabel('Demonstrim virtual')).toHaveCount(0);
    }
    await page.getByRole('button',{name:'4 · Provo dhe ruaj',exact:true}).click();
    await page.getByRole('button',{name:'Preview si pronar'}).click();
    await expect(page.getByRole('heading',{name:`F1 ${kind}`,exact:true})).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
    if(kind==='product')await expect(page.getByRole('link',{name:/Faqja e produktit/})).toHaveAttribute('href','https://example.com/f1');
    await page.getByRole('button',{name:'Mbyll panelin'}).click();
    await page.getByRole('button',{name:'Ruaj ndryshimet',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await page.getByTestId('brand-toggle').click();
    await page.getByRole('button',{name:'Objektet e dhomës'}).click();
    await page.getByRole('dialog').getByRole('button',{name:new RegExp(`F1 ${kind}`)}).click();
    await page.getByRole('button',{name:'Ndrysho objektin',exact:true}).click();
    await expect(page.getByLabel('Lloji i ikonës')).toHaveValue(kind);
    await expect(page.getByRole('navigation',{name:'Hapat e objektit'})).toHaveCount(0);
    await page.getByLabel('Emri i objektit',{exact:true}).fill(`F1 ${kind} edited`);
    await page.getByRole('button',{name:'Ruaj ndryshimet',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved=await page.evaluate(async()=>await(await fetch('/api/v1/home')).json());
    expect(saved.objects.find((o:{name:string})=>o.name===`F1 ${kind} edited`).kind).toBe(kind);
  }
  expect(commands).toEqual([]);
  await page.evaluate(async(revision)=>{const h=await(await fetch('/api/v1/home')).json();const r=await fetch('/api/v1/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,expectedRevision:h.revision})});if(!r.ok)throw Error('F1 categories restore failed');},original.revision);
});

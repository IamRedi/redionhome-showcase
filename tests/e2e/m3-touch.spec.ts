import {test,expect} from '@playwright/test';
test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
test('touch taps activate panorama portals and objects while marker drags do not',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).tap(); await page.getByTestId('brand-toggle').click();await expect(page.getByRole('heading',{name:'Atelie.',exact:true})).toBeVisible();await expect(page.locator('.world-loading')).toHaveCount(0);
 await page.getByRole('button',{name:'Modaliteti admin'}).tap();
 // Place disposable demo markers within reach. Never change owner panoramas/configuration.
 await page.evaluate(async()=>{const h=await(await fetch('/api/v1/home')).json();h.scenes[0].hotspots.find((p:{objectId:string})=>p.objectId==='to-studio').position={yaw:0,pitch:0};h.scenes[1].hotspots.find((p:{objectId:string})=>p.objectId==='to-atelier').position={yaw:0,pitch:0};const r=await fetch('/api/v1/home',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(h)});if(!r.ok)throw Error('Fixture save failed');});
 await page.reload(); await page.getByTestId('brand-toggle').click();await expect(page.locator('.world-loading')).toHaveCount(0);
 const forward=page.getByRole('button',{name:'Eksploro studion',exact:true});await forward.tap();await expect(page.getByRole('heading',{name:'Studio.',exact:true})).toBeVisible({timeout:5000});await expect(page.locator('.world-loading')).toHaveCount(0);
 // The destination opens at its saved forward-facing orientation, not looking back at the entry portal.
 await expect(page.getByRole('button',{name:'Kthehu në atelie',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Atelie',exact:true}).tap();await expect(page.getByRole('heading',{name:'Atelie.',exact:true})).toBeVisible();await expect(page.locator('.world-loading')).toHaveCount(0);
 // Real touch protocol, beginning on a marker: dragging is camera movement, not activation.
 await page.locator('.panorama').focus();await page.keyboard.press('Home');await expect(forward).toBeVisible();
 const box=await forward.boundingBox();expect(box).not.toBeNull();const touch=await page.context().newCDPSession(page);const x=box!.x+box!.width/2,y=box!.y+box!.height/2;
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=6;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*10,y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
 await expect(page.getByRole('heading',{name:'Atelie.',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
 // Reposition the next synthetic touch target after the drag assertion so marker visibility is deterministic.
 await page.evaluate(async()=>{const h=await(await fetch('/api/v1/home')).json();h.scenes[0].hotspots.find((p:{objectId:string})=>p.objectId==='artwork').position={yaw:0,pitch:0};h.scenes[0].hotspots.find((p:{objectId:string})=>p.objectId==='to-studio').position={yaw:.65,pitch:0};const r=await fetch('/api/v1/home',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(h)});if(!r.ok)throw Error('Touch target save failed');});
 await page.reload(); await page.getByTestId('brand-toggle').click();await expect(page.locator('.world-loading')).toHaveCount(0);
 await page.getByRole('button',{name:'Brenda ateliesë',exact:true}).tap();await expect(page.getByRole('dialog')).toContainText('Poly Haven');await page.getByRole('button',{name:'Mbyll panelin',exact:true}).tap();
 await page.getByRole('button',{name:'Edit me prekje',exact:true}).tap();await page.getByRole('button',{name:'Brenda ateliesë',exact:true}).tap();await expect(page.getByLabel('Emri i objektit',{exact:true})).toHaveValue('Brenda ateliesë');await page.getByRole('button',{name:'Mbyll panelin',exact:true}).tap();await page.getByRole('button',{name:'Mbarova',exact:true}).tap();
 // Keyboard activation remains available alongside the viewer's touch/mouse selection event.
 const keyboardTarget=page.getByRole('button',{name:'Brenda ateliesë',exact:true});await keyboardTarget.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toContainText('Poly Haven');await page.getByRole('button',{name:'Mbyll panelin',exact:true}).click();
 expect(errors).toEqual([]);
 await page.evaluate(async()=>{const h=await(await fetch('/api/v1/home')).json();const r=await fetch('/api/v1/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:1,expectedRevision:h.revision})});if(!r.ok)throw Error('Restore failed');});
});

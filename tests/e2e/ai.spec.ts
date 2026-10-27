import {test,expect} from '@playwright/test';

test('owner AI chat proposes safely and executes only after explicit confirmation',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.getByLabel('Fjalëkalimi',{exact:true}).fill('disposable-e2e-password-42');await page.getByRole('button',{name:'Hyni në hapësirën tuaj'}).click(); await page.getByTestId('brand-toggle').click();await expect(page.getByRole('button',{name:'R AI'})).toBeVisible();await expect(page.locator('.world-loading')).toHaveCount(0);
 const state=()=>page.evaluate(async()=>await(await fetch('/api/v1/devices')).json());await page.evaluate(async()=>{const response=await fetch('/api/v1/commands',{method:'POST',headers:{'Content-Type':'application/json','X-RediOnHome-Command-Protocol':'2'},body:JSON.stringify({objectId:'light',action:'turn_off'})});if(!response.ok)throw Error('Synthetic reset failed');});expect((await state()).entities[0].state).toBe('off');
 await page.getByRole('button',{name:'R AI'}).click();await expect(page.getByRole('dialog',{name:'Asistenti AI'})).toContainText('AI aktive');
 await page.getByRole('button',{name:'Lejet',exact:true}).click();
 await page.getByLabel('Mënyra e lejes',{exact:true}).selectOption('confirm');
 await page.getByLabel('Lejo Drita e ateliesë',{exact:true}).check();
 await page.getByRole('button',{name:'Ruaj lejet',exact:true}).click();
 await expect(page.getByText('Lejet u ruajtën.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Biseda',exact:true}).click();
 await page.getByLabel('Mesazhi për AI').fill('Ndiz dritën e ateliesë');await page.getByRole('button',{name:'Dërgo te AI'}).click();
 await expect(page.getByText('Përgjigje prove: Ndiz dritën e ateliesë')).toBeVisible();await expect(page.getByText(/ende të paekzekutuara/)).toBeVisible();
 expect((await state()).entities[0].state).toBe('off');
 page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Shqyrto dhe konfirmo komandat'}).click();await expect(page.getByRole('button',{name:'Komandat u konfirmuan'})).toBeVisible();
 expect((await state()).entities[0].state).toBe('on');
 await page.getByRole('button',{name:'Hap objektin'}).click();await expect(page.getByRole('dialog')).toContainText('Drita e ateliesë');expect(errors).toEqual([]);
});

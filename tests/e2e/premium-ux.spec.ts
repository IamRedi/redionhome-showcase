import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill('disposable-e2e-password-42');
  await page.getByRole('button', { name: 'Hyni në hapësirën tuaj' }).click(); await page.getByTestId('brand-toggle').click();
  await page.getByRole('button', { name: 'Modaliteti admin' }).click();
  await expect(page.getByRole('heading', { name: 'Atelie.' })).toBeVisible();
  await expect(page.locator('.world-loading')).toHaveCount(0);
}

test('immersive hierarchy, back restore, mobile editor and direct light toggle', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);

  await page.locator('.panorama').focus();
  await page.keyboard.press('ArrowRight');
  const orientation = await page.locator('.compass svg').getAttribute('style');
  await page.locator('.scene-card').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Studio.' })).toBeVisible();
  await expect(page.locator('.world-loading')).toHaveCount(0);
  await page.locator('.scene-card').nth(0).click();
  await expect(page.getByRole('heading', { name: 'Atelie.' })).toBeVisible();
  await expect(page.locator('.world-loading')).toHaveCount(0);
  await expect(page.locator('.compass svg')).toHaveAttribute('style', orientation ?? '');
  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Rafti i veglave/ }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Rafti i veglave' })).toBeVisible();
  await page.getByRole('button', { name: 'Hap Sirtari i punës' }).click();
  await page.getByRole('button', { name: 'Hap Veglat' }).click();
  await page.getByRole('button', { name: 'Hap Pincat' }).click();
  await expect(page.getByLabel('Hierarkia e objektit')).toContainText('Rafti i veglave');
  await expect(page.getByLabel('Hierarkia e objektit')).toContainText('Pincat');
  await page.screenshot({ path: `docs/premium-ux/after-hierarchy-${info.project.name}.jpg`, type: 'jpeg', quality: 88 });
  await page.getByRole('button', { name: 'Prapa' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Veglat' })).toBeVisible();
  await page.getByRole('button', { name: 'Mbyll panelin' }).click();
  await expect(page.locator('.compass svg')).toHaveAttribute('style', orientation ?? '');

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Rafti i veglave/ }).click();
  await page.getByRole('button', { name: 'Shto nivel' }).click();
  await page.getByLabel('Emri i objektit', { exact: true }).fill(`Kuti prove ${info.project.name}`);
  await page.getByLabel('Përshkrimi').fill('Nivel i krijuar nga editori mobil universal.');
  await page.getByLabel('Lloji i ikonës').selectOption('drawer');
  await page.getByRole('button',{name:'2 · Pozicioni',exact:true}).click();
  await expect(page.getByLabel('Niveli / prindi')).toHaveValue('shelf');
  await page.getByRole('button',{name:'4 · Provo dhe ruaj',exact:true}).click();
  await page.getByRole('button', { name: 'Preview si pronar' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: `Kuti prove ${info.project.name}` })).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('ende nuk ka fotografi');
  await page.getByRole('button', { name: 'Mbyll panelin' }).click();
  await page.getByRole('button', { name: 'Ruaj ndryshimet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.evaluate(async () => {
    const home = await (await fetch('/api/v1/home')).json();
    const pin = home.scenes[0].hotspots.find((hotspot: { objectId: string }) => hotspot.objectId === 'light');
    pin.position = { yaw: 0, pitch: 0 };
    const response = await fetch('/api/v1/home', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(home) });
    if (!response.ok) throw Error('Fixture positioning failed');
  });
  await page.reload(); await page.getByTestId('brand-toggle').click();
  await expect(page.locator('.world-loading')).toHaveCount(0);
  const light = page.locator('button.world-pin.kind-light');
  await expect(light).toBeVisible();
  const before = await light.getAttribute('aria-label');
  if (info.project.name === 'mobile') await light.tap(); else await light.click();
  await expect.poll(async () => await light.getAttribute('aria-label')).not.toBe(before);

  await light.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 91, button: 0, clientX: 10, clientY: 10 });
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Drita e ateliesë', level: 2 })).toBeVisible({ timeout: 1500 });
  await page.locator('body').dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 91, button: 0, clientX: 10, clientY: 10 });
  await expect(page.getByRole('switch', { name: /Drita e ateliesë/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mbyll panelin' }).click();

  await page.getByTestId('brand-toggle').click();
  await expect(page.locator('.scene-shade')).toHaveCSS('visibility', 'hidden');
  // F1 owner requirement: hiding menus must not hide icons (eye remains ON).
  await expect(light).toBeVisible();
  await page.getByTestId('brand-toggle').click();
  await expect(light).toBeVisible();
  await expect(light).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.mouse.move(8, 8);
  await expect(light.locator('.pin-label')).toHaveCSS('visibility', 'hidden');
  const after = await light.getAttribute('aria-label');
  if (after?.includes('Ndezur')) {
    await expect(light).toHaveClass(/device-on/);
    expect(await light.evaluate((element) => getComputedStyle(element).filter)).not.toBe('none');
  } else {
    await expect(light).toHaveClass(/device-off/);
    expect(await light.evaluate((element) => getComputedStyle(element).filter)).toBe('none');
  }

  await page.evaluate(async () => {
    const home = await (await fetch('/api/v1/home')).json();
    const response = await fetch('/api/v1/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1, expectedRevision: home.revision }) });
    if (!response.ok) throw Error('Fixture restore failed');
  });
});

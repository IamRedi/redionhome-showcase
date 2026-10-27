import { expect, test } from '@playwright/test';

test('RDH-03 pairs fridge doors, keeps the journal private and presents the art gallery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill('disposable-e2e-password-42');
  await page.getByRole('button', { name: 'Hyni në hapësirën tuaj' }).click(); await page.getByTestId('brand-toggle').click();
  await expect(page.getByRole('heading', { name: 'Atelie.', exact: true })).toBeVisible();
  await expect(page.locator('.world-loading')).toHaveCount(0);

  await page.evaluate(async () => {
    const home = await (await fetch('/api/v1/home')).json();
    if (!home.objects) throw Error('home response: ' + JSON.stringify(home).slice(0, 200));
    const artwork = home.objects.find((object: { id: string }) => object.id === 'artwork');
    artwork.actions = [{ type: 'info' }, { type: 'demo', demo: 'fridge' }];
    artwork.experiences = { version: 1, private: { version: 1, journal: [{ id: 'note-e2e-1', at: Date.now(), text: 'Shënim privat: drita e ateliesë është më e mirë në mbrëmje.' }] } };
    const response = await fetch('/api/v1/home', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(home) });
    if (!response.ok) throw Error('RDH-03 seed save failed');
  });
  await page.reload(); await page.getByTestId('brand-toggle').click();
  await expect(page.locator('.world-loading')).toHaveCount(0);

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Brenda ateliesë/ }).click();

  const fridge = page.locator('.virtual-fridge');
  await expect(fridge).toHaveAttribute('data-state', 'closed');
  await page.getByRole('button', { name: 'Hap dyën (pamja e çiftuar)' }).click();
  await expect(fridge).toHaveAttribute('data-state', 'open');
  await page.getByRole('button', { name: 'Mbyll dyën' }).click();
  await expect(fridge).toHaveAttribute('data-state', 'closed');

  await expect(page.getByRole('dialog')).toContainText('Journal privat');
  await expect(page.getByRole('dialog')).toContainText('Shënim privat: drita e ateliesë');

  await page.getByRole('button', { name: 'Hap galerinë art në ekran të plotë' }).click();
  const art = page.locator('.gallery-fullscreen');
  await expect(art).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(art).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.evaluate(async () => {
    const home = await (await fetch('/api/v1/home')).json();
    const response = await fetch('/api/v1/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1, expectedRevision: home.revision }) });
    if (!response.ok) throw Error('Cleanup restore failed');
  });
});

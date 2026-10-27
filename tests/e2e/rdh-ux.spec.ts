import { expect, test } from '@playwright/test';

test('RDH-UX-01 normal mode shows only contextual controls; admin mode reveals configuration', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/devices', route => route.fulfill({ json: { mode: 'mock', connection: 'online', entities: [
    { bindingId: 'demo-light', entityId: 'light.demo', name: 'Drita e ateliesë', state: 'off', source: 'mock', controlEnabled: true, capabilities: ['power', 'brightness'], commandCapabilities: ['power', 'brightness'], category: 'light', brightness: 40 },
    { bindingId: 'tv-binding', entityId: 'media_player.living_room_tv_2', name: 'Living Room TV', state: 'on', source: 'home-assistant', controlEnabled: false, capabilities: ['playback', 'volume'], commandCapabilities: [], category: 'tv', values: { volume_level: 3 } },
  ] } }));
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill('disposable-e2e-password-42');
  await page.getByRole('button', { name: 'Hyni në hapësirën tuaj' }).click(); await page.getByTestId('brand-toggle').click();
  await expect(page.getByRole('heading', { name: 'Atelie.', exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: '+ Shto' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit me prekje' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Settings · Integrations' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tour & ftesat' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'R AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modaliteti admin' })).toBeVisible();

  await page.evaluate(async () => {
    const home = await (await fetch('/api/v1/home')).json();
    const tv = home.objects.find((object: { id: string }) => object.id === 'shelf')!;
    tv.kind = 'tv';
    tv.name = 'TV e dhomës së ndenjes';
    tv.actions = [{ type: 'device', bindingId: 'tv-binding' }];
    const response = await fetch('/api/v1/home', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(home) });
    if (!response.ok) throw Error('RDH-UX seed failed');
  });
  await page.reload(); await page.getByTestId('brand-toggle').click();
  await expect(page.getByRole('heading', { name: 'Atelie.', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Drita e ateliesë/ }).click();
  const lightPanel = page.getByRole('dialog');
  await expect(lightPanel.getByRole('switch')).toHaveCount(1);
  await expect(lightPanel.getByRole('button', { name: 'Ndrysho' })).toHaveCount(0);
  await expect(lightPanel.getByRole('button', { name: 'Shto nivel' })).toHaveCount(0);
  await expect(lightPanel.getByRole('button', { name: 'Lidhje smart' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /TV e dhomës së ndenjes/ }).click();
  const tvPanel = page.getByRole('dialog');
  await expect(tvPanel).toContainText('Gjendje live në kohë reale');
  await expect(tvPanel).toContainText('Volumi');
  await expect(tvPanel.getByRole('switch')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Brenda ateliesë/ }).click();
  await page.getByRole('button', { name: 'Hap galerinë art në ekran të plotë' }).click();
  await expect(page.locator('.gallery-fullscreen')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Modaliteti admin' }).click();
  await expect(page.getByRole('button', { name: '+ Shto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit me prekje' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings · Integrations' })).toBeVisible();

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Drita e ateliesë/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Ndrysho' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Ndrysho' }).click();
  await expect(page.locator('.sheet').last()).toContainText('Paneli ditor tregon vetëm ON/OFF');
  expect(errors).toEqual([]);
  await page.evaluate(async () => {
    const home = await (await fetch('/api/v1/home')).json();
    const response = await fetch('/api/v1/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 1, expectedRevision: home.revision }) });
    if (!response.ok) throw Error('Cleanup restore failed');
  });
});

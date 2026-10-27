import { expect, test } from '@playwright/test';

test('RDH-01 edits and previews one object as Private Home and Showroom', async ({ page }) => {
  const errors: string[] = [];
  const commands: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/commands')) commands.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill('disposable-e2e-password-42');
  await page.getByRole('button', { name: 'Hyni në hapësirën tuaj' }).click(); await page.getByTestId('brand-toggle').click();
  await page.getByRole('button', { name: 'Modaliteti admin' }).click();
  await expect(page.locator('.world-loading')).toHaveCount(0);

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Eksploro studion/ }).click();
  await expect(page.getByRole('heading', { name: 'Studio.' })).toBeVisible();
  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Workstation privat/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Workstation · Private Home');
  await expect(page.getByRole('link', { name: 'Paneli privat ↗' })).toBeVisible();

  await page.getByRole('button', { name: 'Ndrysho objektin', exact: true }).click();
  await page.getByText('Përvoja Private & Showroom', { exact: true }).click();
  await expect(page.getByLabel('Përdor profil privat të veçantë')).toBeChecked();
  await expect(page.getByLabel('Përdor profil Showroom të veçantë')).toBeChecked();
  await expect(page.getByLabel('Titulli i profilit').nth(1)).toHaveValue('Creative Workstation');
  await expect(page.getByLabel('Deep link i aplikacionit')).toHaveValue('spotify:search:focus');
  await expect(page.getByLabel('Fallback HTTPS')).toHaveValue('https://open.spotify.com');

  await page.getByRole('button', { name: 'Preview si vizitor', exact: true }).click();
  const preview = page.getByRole('dialog').last();
  await expect(preview).toContainText('Creative Workstation');
  await expect(preview).not.toContainText('Paneli privat');
  await expect(preview.getByRole('link', { name: 'Hap në Spotify' })).toHaveAttribute('href', 'spotify:search:focus');
  await expect(preview.getByRole('link', { name: 'Hap në web ↗' })).toHaveAttribute('href', 'https://open.spotify.com');
  await expect(preview.getByRole('switch')).toHaveCount(0);
  expect(commands).toEqual([]);
  expect(errors).toEqual([]);
});

test('RDH-01 MOCK light can be explicitly detached, edited, and have its hotspot removed', async ({ page }) => {
  page.on('dialog', dialog => void dialog.accept());
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill('disposable-e2e-password-42');
  await page.getByRole('button', { name: 'Hyni në hapësirën tuaj' }).click(); await page.getByTestId('brand-toggle').click();
  await page.getByRole('button', { name: 'Modaliteti admin' }).click();
  await expect(page.locator('.world-loading')).toHaveCount(0);

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Drita e ateliesë/ }).click();
  await page.getByRole('button', { name: 'Ndrysho objektin', exact: true }).click();
  await expect(page.getByText('Dritë testuese · MOCK', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Shkëpute dritën testuese MOCK', exact: true }).click();
  await expect(page.getByLabel('Veprimi', { exact: true })).toHaveValue('info');
  await page.getByLabel('Emri i objektit', { exact: true }).fill('Dritë MOCK e shkëputur');
  await page.getByRole('button', { name: 'Ruaj ndryshimet', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  let home = await page.evaluate(async () => await (await fetch('/api/v1/home')).json());
  const light = home.objects.find((object: { id: string }) => object.id === 'light');
  expect(light.name).toBe('Dritë MOCK e shkëputur');
  expect(light.actions).toEqual([{ type: 'info' }]);

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Dritë MOCK e shkëputur/ }).click();
  await page.getByRole('button', { name: 'Ndrysho objektin', exact: true }).click();
  await page.getByLabel('Hiq hotspot-in', { exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  home = await page.evaluate(async () => await (await fetch('/api/v1/home')).json());
  expect(home.objects.find((object: { id: string }) => object.id === 'light').actions).toEqual([{ type: 'info' }]);
  expect(home.scenes.flatMap((scene: { hotspots: { objectId: string }[] }) => scene.hotspots).some((hotspot: { objectId: string }) => hotspot.objectId === 'light')).toBe(false);
  const restore = await page.request.post('/api/v1/restore', { headers: { Origin: 'http://127.0.0.1:4184' }, data: { revision: 1, expectedRevision: home.revision } });
  expect(restore.ok()).toBe(true);
});

test('RDH-01 names an invalid link, preserves the draft, and accepts ordinary and private links', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill('disposable-e2e-password-42');
  await page.getByRole('button', { name: 'Hyni në hapësirën tuaj' }).click(); await page.getByTestId('brand-toggle').click();
  await page.getByRole('button', { name: 'Modaliteti admin' }).click();
  await expect(page.locator('.world-loading')).toHaveCount(0);

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Eksploro studion/ }).click();
  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Workstation privat/ }).click();
  await page.getByRole('button', { name: 'Ndrysho objektin', exact: true }).click();
  await page.getByText('Përvoja Private & Showroom', { exact: true }).click();
  const showroomLink = page.getByLabel('Lidhje publike HTTPS');
  const privateLink = page.getByLabel('Lidhje private HTTPS');

  await showroomLink.fill('https://user:pass@example.com/workstation');
  await page.getByRole('button', { name: 'Ruaj ndryshimet', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Kontrolloni linkun: pa kredenciale');
  await expect(showroomLink).toHaveValue('https://user:pass@example.com/workstation');

  await showroomLink.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await privateLink.fill('http://127.0.0.1:8123/lovelace?view=1');
  await page.getByRole('button', { name: 'Ruaj ndryshimet', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const home = await page.evaluate(async () => await (await fetch('/api/v1/home')).json());
  const workstation = home.objects.find((object: { name?: string }) => object.name === 'Workstation privat');
  const privateLinkAction = workstation?.experiences?.private?.actions?.find((action: { type: string }) => action.type === 'link');
  expect(privateLinkAction?.url).toBe('http://127.0.0.1:8123/lovelace?view=1');
  const showroomLinkAction = workstation?.experiences?.showroom?.actions?.find((action: { type: string }) => action.type === 'link');
  expect(showroomLinkAction?.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const restore = await page.request.post('/api/v1/restore', { headers: { Origin: 'http://127.0.0.1:4184' }, data: { revision: 1, expectedRevision: home.revision } });
  expect(restore.ok()).toBe(true);
});

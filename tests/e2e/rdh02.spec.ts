import { expect, test } from '@playwright/test';

test('RDH-02 presents the workstation hub, showroom-only demos, and Spotify fallback without device commands', async ({ page }) => {
  const commands: string[] = [];
  const errors: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/commands')) commands.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByLabel('Fjalëkalimi', { exact: true }).fill('disposable-e2e-password-42');
  await page.getByRole('button', { name: 'Hyni në hapësirën tuaj' }).click(); await page.getByTestId('brand-toggle').click();
  await page.getByRole('button', { name: 'Modaliteti admin' }).click();
  await expect(page.locator('.world-loading')).toHaveCount(0);

  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Eksploro studion/ }).click();
  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Workstation privat/ }).click();
  const privateHub = page.getByRole('dialog');
  await expect(privateHub.getByText('Projektet & demonstrimet')).toBeVisible();
  await expect(privateHub.getByRole('link', { name: 'Hap GitHub ↗' })).toHaveAttribute('href', 'https://github.com/IamRedi');

  await page.getByRole('button', { name: 'Ndrysho objektin', exact: true }).click();
  await page.getByRole('button', { name: 'Preview si vizitor', exact: true }).click();
  const showroom = page.getByRole('dialog').last();
  await expect(showroom).toContainText('Piano Core');
  await expect(showroom).not.toContainText('Portfolio privat');
  await showroom.getByRole('button', { name: 'Shiko demonstrimin' }).first().click();
  await expect(showroom.getByText('Simulim lokal · pa lidhje me pajisje')).toBeVisible();
  await expect(showroom.getByRole('button', { name: 'Tasti virtual Do', exact: true })).toBeVisible();

  await showroom.getByRole('button', { name: 'Mbyll' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mbyll panelin' }).click();
  await page.getByRole('button', { name: 'Objektet e dhomës' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Kitara/ }).click();
  await expect(page.getByRole('link', { name: 'Hap playlistën në Spotify' })).toHaveAttribute('href', 'spotify:playlist:37i9dQZF1DX4dyzvuaRJ0n');
  await expect(page.getByRole('link', { name: 'Hap në web ↗' })).toHaveAttribute('href', 'https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n');
  expect(commands).toEqual([]);
  expect(errors).toEqual([]);
});

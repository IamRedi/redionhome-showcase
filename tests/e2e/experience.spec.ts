import { test, expect } from "@playwright/test";
test("panorama, navigation, object control, editor persistence and restore", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  let tileResponses = 0;
  page.on("response", (response) => {
    if (
      /\/media\/atelier\/[01]-\d+-\d+\.jpg/.test(response.url()) &&
      response.status() === 200
    )
      tileResponses++;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Hapësira juaj/ }),
  ).toBeVisible();
  await page
    .getByLabel("Fjalëkalimi", { exact: true })
    .fill("disposable-e2e-password-42");
  await page.getByRole("button", { name: "Hyni në hapësirën tuaj" }).click(); await page.getByTestId('brand-toggle').click();
  await page.getByRole('button', { name: 'Modaliteti admin' }).click();
  await expect(page.getByRole("heading", { name: "Atelie." })).toBeVisible();
  await expect(page.locator(".world-loading")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Brenda ateliesë", exact: true }),
  ).toBeVisible();
  // Wait for the actual tile downloads, not an arbitrary delay.
  await expect.poll(() => tileResponses).toBeGreaterThan(0);
  await page.screenshot({
    path: `docs/m3/regression-${testInfo.project.name}.jpg`,
    type: "jpeg",
    quality: 85,
  });
  // Panorama toolbar was removed by F1; exercise its supported keyboard replacement.
  await page.locator(".panorama").focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("-");
  await page.getByRole("button", { name: "Objektet e dhomës" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Brenda ateliesë/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Poly Haven");
  await page.screenshot({
    path: `docs/m3/regression-${testInfo.project.name}-object.jpg`,
    type: "jpeg",
    quality: 85,
  });
  await page.getByRole("button", { name: "Mbyll panelin" }).click();
  await page.getByRole("button", { name: "Objektet e dhomës" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Drita e ateliesë/ })
    .click();
  const toggle = page.getByRole("switch", { name: /Drita e ateliesë/ });
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).toHaveAttribute(
    "aria-checked",
    before === "true" ? "false" : "true",
  );
  await page.getByRole("button", { name: "Mbyll panelin" }).click();
  await page.getByRole("button", { name: "Objektet e dhomës" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Eksploro studion/ })
    .click();
  await expect(page.getByRole("heading", { name: "Studio." })).toBeVisible();
  await expect(page.locator(".world-loading")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Pamjet" })
    .getByRole("button", { name: /Atelie/ })
    .click();
  await expect(page.getByRole("heading", { name: "Atelie." })).toBeVisible();
  await expect(page.locator(".world-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "+ Shto" }).click();
  await page.getByRole("button", { name: /Objekt \/ Foto \/ Video/ }).click();
  await page.getByLabel("Hotspot-i", { exact: true }).selectOption("");
  await page
    .getByLabel("Emri i objektit", { exact: true })
    .fill(`Objekt prove ${testInfo.project.name}`);
  await page
    .getByLabel("Përshkrimi")
    .fill("Ruajtje dhe versionim real në SQLite.");
  await page.screenshot({
    path: `docs/m3/regression-${testInfo.project.name}-editor.jpg`,
    type: "jpeg",
    quality: 85,
  });
  await page.getByRole("button", {name:"2 · Pozicioni",exact:true}).click();
  await page
    .getByRole("button", { name: "Zgjidh pozicionin në panoramë" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const box = await page.locator("canvas").boundingBox();
  expect(box).not.toBeNull();
  await expect(page.locator("canvas")).toHaveJSProperty("tagName", "CANVAS");
  expect(box!.x).toBe(0);
  expect(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest(".panorama"),{x:box!.width*.6,y:box!.height*.32})).toBe(true);
  await page.mouse.click(box!.width * 0.6, box!.height * 0.32);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", {name:"1 · Objekti",exact:true}).click();
  await expect(page.getByLabel("Emri i objektit", { exact: true })).toHaveValue(
    `Objekt prove ${testInfo.project.name}`,
  );
  await page.getByRole("button", {name:"4 · Provo dhe ruaj",exact:true}).click();
  await page.getByRole("button", { name: "Ruaj ndryshimet" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload(); await page.getByTestId('brand-toggle').click();
  await expect(page.locator(".world-loading")).toHaveCount(0);
  await page.getByRole("button", { name: "Objektet e dhomës" }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", {
      name: new RegExp(`Objekt prove ${testInfo.project.name}`),
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mbyll panelin" }).click();
  await page.getByRole("button", { name: "+ Shto" }).click();
  await page.getByRole("button", { name: /Objekt \/ Foto \/ Video/ }).click();
  await page.getByLabel("Hotspot-i",{exact:true}).selectOption({label:`Objekt prove ${testInfo.project.name}`});
  await page.getByText("Media & versionet", { exact: true }).click();
  await page.getByRole("button", { name: "Shiko versionet" }).click();
  await page
    .getByRole("group", { name: "Versioni 1", exact: true })
    .getByRole("button", { name: "Rikthe" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Fshih hotspot-et" }).click();
  await expect(page.locator(".world-pin").first()).not.toBeVisible();
  await page.getByRole("button", { name: "Shfaq hotspot-et" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const cachedPrivate = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const requests = await Promise.all(
      keys.map(async (key) =>
        (await (await caches.open(key)).keys()).map((request) => request.url),
      ),
    );
    return requests
      .flat()
      .filter((url) => new URL(url).pathname.startsWith("/api/"));
  });
  expect(cachedPrivate).toEqual([]);
  expect(errors).toEqual([]);
  // Logout deliberately reloads the document. Synchronize on that navigation,
  // then assert the authenticated UI has actually been replaced by login.
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded'}),
    page.getByRole("button", { name: "Dil nga llogaria" }).click(),
  ]);
  await expect(page.getByLabel("Fjalëkalimi", { exact: true })).toBeVisible();
});
test("reduced motion, keyboard dialog and graceful device disconnect", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByLabel("Fjalëkalimi", { exact: true })
    .fill("disposable-e2e-password-42");
  await page.getByRole("button", { name: "Hyni në hapësirën tuaj" }).click(); await page.getByTestId('brand-toggle').click();
  await expect(page.locator(".world-loading")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Si funksionon" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.route("**/api/v1/devices", (route) => route.abort());
  await expect(page.locator(".connection")).toHaveClass(/disconnected/, {
    timeout: 10000,
  });
  await page.unroute("**/api/v1/devices");
  await expect(page.locator(".connection")).not.toHaveClass(/disconnected/, {
    timeout: 10000,
  });
});

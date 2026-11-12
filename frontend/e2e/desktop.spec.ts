import { test, expect } from "@playwright/test";

/* Desktop chrome: sidebar navigation and hotkeys. */

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop chrome only");
});

test("sidebar navigates views", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".mobile-tabs")).toBeHidden();
  const nav = page.getByRole("navigation", { name: "Navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Ops Board" }).click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/kanban");
  await expect(page.locator(".kb-lane").first()).toBeVisible();
});

test("single-letter hotkeys switch views", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("k");
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/kanban");
  await page.keyboard.press("b");
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/brief");
});

test("keys panel opens and closes", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("?");
  await expect(page.locator(".chrome-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".chrome-dialog")).toHaveCount(0);
});

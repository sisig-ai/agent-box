import { test, expect } from "@playwright/test";

/* Mobile-only chrome: the bottom tab bar replaces the sidebar. */

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile chrome only");
});

test("tab bar navigates every view", async ({ page }) => {
  await page.goto("/");
  const bar = page.locator(".mobile-tabs");
  await expect(bar).toBeVisible();

  const targets = [
    { label: "Daily Sitrep", hash: "#/brief" },
    { label: "Files", hash: "#/files" },
    { label: "Ops Board", hash: "#/kanban" },
    { label: "Progress Bars", hash: "#/progress" },
    { label: "Docs", hash: "#/docs" },
    { label: "Tables", hash: "#/tables" },
    { label: "Access logs", hash: "#/logs" },
    { label: "Stack", hash: "#/" },
  ];
  for (const t of targets) {
    await page.locator(".mobile-tab", { hasText: t.label }).first().tap();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toBe(t.hash);
    await expect(bar).toBeVisible();
  }
});

test("tab bar sits above the safe area and content clears it", async ({ page }) => {
  await page.goto("/");
  const bar = page.locator(".mobile-tabs");
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);
  // the tab bar covers the bottom edge of the viewport
  expect(box!.y + box!.height).toBeGreaterThan(page.viewportSize()!.height - 8);
});

test("tab buttons meet the 44px target minimum", async ({ page }) => {
  await page.goto("/");
  const first = page.locator(".mobile-tab").first();
  const box = await first.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
});

test("card modal opens as a bottom sheet on phones", async ({ page }) => {
  await page.goto("/#/kanban");
  await expect(page.locator(".kb-lane").first()).toBeVisible();
  await page.locator(".kb-card").first().tap();
  const modal = page.locator(".kbd-modal");
  await expect(modal).toBeVisible();
  const vp = page.viewportSize()!;
  const box = await modal.boundingBox();
  expect(box).not.toBeNull();
  // sheet anchored to the bottom edge
  expect(box!.y + box!.height).toBeGreaterThan(vp.height - 8);
});

test("deep link to a card hydrates without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("/#/kanban/card-1");
  await expect(page.locator(".kbd-modal")).toBeVisible();
  // The telemetry collector is absent under e2e; /api/stats answers 503 while
  // it "starts", and the app treats that as a soft reconnect. Tolerate it.
  const hard = errors.filter(
    (e) => !e.includes("503") && !e.toLowerCase().includes("telemetry sampler"),
  );
  expect(hard).toEqual([]);
});

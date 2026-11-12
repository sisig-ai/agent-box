import { test, expect } from "@playwright/test";

/* Every spec shares one seeded server. These checks run per project
   (mobile + desktop). */

test.beforeEach(async ({ page }) => {
  // Surface uncaught page errors and console errors as test failures.
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  await page.addInitScript(() => {
    (window as unknown as { __e2eErrors: string[] }).__e2eErrors = [];
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const errors = await page
    .evaluate(() => (window as unknown as { __e2eErrors?: string[] }).__e2eErrors ?? [])
    .catch(() => [] as string[]);
  if (errors.length) {
    console.log(`page errors in ${testInfo.title}:`, errors);
  }
});

test("every view renders its landmark content", async ({ page }) => {
  const views = [
    { hash: "#/brief", probe: ".sitrep, .sitrep-editor" },
    { hash: "#/", probe: ".scanner input" },
    { hash: "#/files", probe: ".files-table, .files-root" },
    { hash: "#/kanban", probe: ".kb-lane" },
    { hash: "#/progress", probe: ".pb-card, .pb-empty" },
    { hash: "#/docs", probe: ".docs-body, .docs-list" },
    { hash: "#/tables", probe: ".tbl-body" },
    { hash: "#/logs", probe: ".logs-table" },
  ];
  for (const view of views) {
    await page.goto(`/${view.hash}`);
    await expect(page.locator(view.probe).first()).toBeVisible({ timeout: 8000 });
  }
});

test("no horizontal overflow on any view", async ({ page }) => {
  for (const hash of ["#/", "#/brief", "#/files", "#/kanban", "#/progress", "#/docs", "#/tables", "#/logs"]) {
    await page.goto(`/${hash}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${hash}`).toBeLessThanOrEqual(1);
  }
});

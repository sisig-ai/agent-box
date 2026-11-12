import { test, expect } from "@playwright/test";

/* PWA install surface: manifest, metadata, service worker, offline shell. */

test("index carries the PWA metadata", async ({ page }) => {
  await page.goto("/");
  const manifest = page.locator('link[rel="manifest"]');
  await expect(manifest).toHaveAttribute("href", "/manifest.webmanifest");
  const content = await page.content();
  expect(content).toContain("apple-mobile-web-app-capable");
  expect(content).toContain("manifest.webmanifest");
});

test("manifest is valid JSON with a standalone display and icons", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data.display).toBe("standalone");
  expect(data.start_url).toBe("/");
  expect(data.icons.length).toBeGreaterThan(2);
});

test("service worker registers and controls the page", async ({ page }) => {
  await page.goto("/");
  const ok = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(ok).toBeTruthy();
});

test("app shell survives going offline", async ({ page, context }) => {
  await page.goto("/");
  // Wait until the worker has cached the shell (install + activate).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // give the worker a beat to finish any cache puts from the load
    await new Promise((r) => setTimeout(r, 500));
  });
  await context.setOffline(true);
  const res = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(res?.status()).toBe(200);
  await expect(page.locator(".mobile-tabs, nav[aria-label='Navigation']").first()).toBeVisible();
  await context.setOffline(false);
});

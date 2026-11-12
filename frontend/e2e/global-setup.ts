/* Playwright globalSetup: wait for the webServer, then seed fixture data.
   The server itself is owned by the webServer config, so this only polls
   readiness and posts the seed rows. */

import type { FullConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 4599);
const BASE = `http://127.0.0.1:${PORT}`;

async function j(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // 409 = already seeded with this shape; the suite tolerates re-runs.
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.json().catch(() => null);
}

export default async function globalSetup(_config: FullConfig) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/kanban`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (i === 119) throw new Error("e2e server never came up");
    await new Promise((r) => setTimeout(r, 500));
  }

  /* Ops board: two extra lanes, cards with bodies. */
  const board = await j("GET", "/api/kanban");
  const lanes: string[] = board.lanes.map((l: { lane: string }) => l.lane);
  if (!lanes.includes("Doing")) await j("POST", "/api/kanban/lanes", { name: "Doing" });
  if (!lanes.includes("Done")) await j("POST", "/api/kanban/lanes", { name: "Done" });

  await j("POST", "/api/kanban/cards", {
    title: "e2e: polish mobile board",
    owner: "e2e",
    status: "Doing",
    body: "## Goal\nmake the board daily-drivable on a phone.\n\n- [ ] tab bar\n- [x] snap lanes",
    opname: "mobile-polish",
  });
  await j("POST", "/api/kanban/cards", {
    title: "e2e: verify hydration on deep links",
    owner: "e2e",
    status: "Done",
    body: "Deep link to #/kanban/card-1 and check the console.",
  });

  /* Progress bars: one root so the recursion renders. */
  await j("POST", "/api/progress", { title: "e2e polish pass", percent: 42, fields: { batch: "m5" } });

  /* Sitrep for the brief view. */
  await j("PUT", "/api/sitrep", {
    content: "# Sitrep\n\n- ship the mobile pass\n- green e2e",
    date: new Date().toISOString().slice(0, 10),
  });

  /* Docs: a tree with children so the twist arrows render. */
  await j("PUT", "/api/docs/handoffs/e2e-mobile", {
    content: "# mobile pass\n\nparity with the old pwa layer.",
    author: "e2e",
    tags: ["e2e", "handoff"],
  });
  await j("PUT", "/api/docs/notes/e2e-checklist", {
    content: "- tab bar\n- sheets\n- sw",
    author: "e2e",
    tags: ["e2e"],
  });
}

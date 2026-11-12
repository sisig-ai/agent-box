import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 4599);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // one server, one seed set — keep runs deterministic
  reporter: process.env.CI ? "line" : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  globalSetup: "./e2e/global-setup.ts",
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["iPhone 14"],
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command:
      process.platform === "win32"
        ? `..\\.venv\\Scripts\\python.exe -m uvicorn app:app --host 127.0.0.1 --port ${PORT} --app-dir ..`
        : `../.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port ${PORT} --app-dir ..`,
    cwd: __dirname,
    url: `http://127.0.0.1:${PORT}/api/kanban`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "ignore",
    env: {
      ...process.env,
      DASH_DATA_DIR: process.env.E2E_DATA_DIR || "/tmp/arr-e2e-data",
      DASH_FS_HOME: process.env.E2E_HOME_DIR || "/tmp/arr-e2e-home",
    },
  },
});

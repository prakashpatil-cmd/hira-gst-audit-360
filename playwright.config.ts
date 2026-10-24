import fs from "node:fs";
import { defineConfig } from "@playwright/test";

const PORT = 3100;
export const E2E_ENV = {
  APP_ENV: "test",
  APP_URL: `http://localhost:${PORT}`,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/hira_gst_e2e",
  DB_LOCAL_SHIM: "true",
  AUTH_PROVIDER: "local",
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789abcdef",
  STORAGE_PROVIDER: "local",
  LOCAL_STORAGE_DIR: "./storage-e2e",
  INLINE_JOBS: "true",
  CRON_SECRET: "e2e-cron",
  AI_PROVIDER: "none",
};

/** E2E_BASE_URL runs the suite against a deployed (staging) URL instead of a local production build. */
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: REMOTE ? undefined : "./tests/e2e/global-setup.ts",
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH || fs.existsSync("/opt/pw-browsers/chromium")
      ? { executablePath: process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" } : {},
  },
  webServer: REMOTE ? undefined : {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_ENV,
  },
});

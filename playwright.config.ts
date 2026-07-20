import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/compare.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

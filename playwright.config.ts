import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const CI = !!process.env.CI;

/** End-to-end checks: a real browser against the built app, Worker and a local D1 database. */
export default defineConfig({
  testDir: "e2e",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // CI runs in Playwright's own image (its Chromium); locally the installed Chrome is used, so nothing is downloaded.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(CI ? {} : { channel: "chrome" }) } }],
  webServer: {
    command: `npm run build && npm run db:migrate:local && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always a fresh build, so a leftover preview server can't be tested by mistake.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

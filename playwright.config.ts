import { defineConfig, devices } from "@playwright/test";

const PORT = 3847;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // The phone tests share one local JSON store. One worker keeps them from overwriting it.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL,
    ...devices["iPhone 13"],
  },
  projects: [{ name: "webkit", use: { browserName: "webkit" } }],
  webServer: {
    command: "npm run dev",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

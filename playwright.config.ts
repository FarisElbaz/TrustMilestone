import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.browser.spec.ts",
  use: { baseURL: "http://127.0.0.1:3127", headless: true },
  webServer: {
    command: "npx tsx src/ui.ts",
    url: "http://127.0.0.1:3127/health",
    reuseExistingServer: true,
    env: {
      PAYMENT_MODE: "mock",
      PAYPAL_ENV: "sandbox",
      SESSION_SECRET: "playwright-test-session-secret",
      PORT: "3127",
      HOST: "127.0.0.1",
    },
  },
});

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: "http://127.0.0.1:3999" },
    },
    {
      // A build with no server address, to see the "service not available" screen.
      command:
        "npx vite build --outDir dist-config && npx vite preview --outDir dist-config --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_BASE_URL: "" },
    },
  ],
  projects: [
    {
      name: "mobile-360",
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 } },
      testIgnore: /timezones\.spec\.ts/,
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
      testIgnore: /timezones\.spec\.ts/,
    },
    {
      name: "tz-madrid",
      use: { ...devices["Desktop Chrome"], timezoneId: "Europe/Madrid" },
      testMatch: /timezones\.spec\.ts/,
    },
    {
      name: "tz-honolulu",
      use: { ...devices["Desktop Chrome"], timezoneId: "Pacific/Honolulu" },
      testMatch: /timezones\.spec\.ts/,
    },
  ],
});

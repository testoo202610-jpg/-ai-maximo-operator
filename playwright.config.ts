import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const folder = process.env.E2E_DB_FOLDER ?? resolve("data/e2e-" + process.pid);
process.env.E2E_DB_FOLDER = folder;
process.env.DATABASE_URL = folder + "/operator.sqlite";
process.env.SIMULATOR_DATABASE_URL = folder + "/simulator.sqlite";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.BROWSER_EXECUTABLE ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    timeout: 90000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL,
      SIMULATOR_DATABASE_URL: process.env.SIMULATOR_DATABASE_URL,
      MAXIMO_MODE: "simulation",
      MAXIMO_CONNECTOR_MODE: "browser",
      APP_ORIGIN: "http://127.0.0.1:5173",
    },
  },
});

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../packages/shared/config.ts";
if (!config.MAXIMO_BASE_URL || !config.MAXIMO_BROWSER_STATE)
  throw new Error("Set MAXIMO_BASE_URL and MAXIMO_BROWSER_STATE outside Git.");
const b = await chromium.launch({
  headless: false,
  executablePath: config.BROWSER_EXECUTABLE,
});
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto(config.MAXIMO_BASE_URL);
console.log(
  "Complete authorized SSO/MFA in the browser, then press Enter here. No credentials are logged.",
);
process.stdin.once("data", async () => {
  mkdirSync(dirname(config.MAXIMO_BROWSER_STATE!), {
    recursive: true,
    mode: 0o700,
  });
  await ctx.storageState({ path: config.MAXIMO_BROWSER_STATE! });
  const { chmodSync } = await import("node:fs");
  chmodSync(config.MAXIMO_BROWSER_STATE!, 0o600);
  await b.close();
  process.exit();
});

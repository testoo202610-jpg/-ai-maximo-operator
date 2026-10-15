import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { config, productionPolicy } from "../shared/config.ts";
import {
  AppError,
  RecordSchema,
  LaborSchema,
  Identity,
  ScheduleValues,
  recordKey,
  validateWrite,
  type RecordData,
  type MaximoConnector,
  type Capabilities,
  type Labor,
} from "../domain/index.ts";
export type BrowserMapping = {
  module: string;
  site: string;
  query: string;
  search: string;
  recordButton: string;
  recordData: string;
  save: string;
  saveStatus: string;
  fields: Record<string, string>;
  listData?: string;
  laborData?: string;
};
export const simulatorMapping: BrowserMapping = {
  module: "#module",
  site: "#site",
  query: "#query",
  search: "#search",
  recordButton: 'button[data-record="{id}"]',
  recordData: "#record-data",
  save: "#save",
  saveStatus: "#save-status",
  fields: {
    scheduledStart: "#scheduledStart",
    scheduledFinish: "#scheduledFinish",
    laborId: "#laborId",
    nextDue: "#nextDue",
  },
};
export const browserOptions = () => ({
  headless: true,
  executablePath:
    config.BROWSER_EXECUTABLE ??
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"],
});
export class BrowserConnector implements MaximoConnector {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private simulation = config.MAXIMO_MODE === "simulation";
  private mapping: BrowserMapping;
  constructor() {
    this.mapping = this.simulation
      ? simulatorMapping
      : config.MAXIMO_MAPPING_FILE
        ? JSON.parse(readFileSync(config.MAXIMO_MAPPING_FILE, "utf8")).browser
        : null;
    if (!this.mapping)
      throw new AppError(
        422,
        "Browser UI mapping is required; an operator must verify selectors",
        "MAPPING",
      );
  }
  private get base() {
    return this.simulation
      ? config.SIMULATOR_BASE_URL
      : config.MAXIMO_BASE_URL!;
  }
  private async start() {
    if (this.page && !this.page.isClosed()) return this.page;
    this.browser = await chromium.launch(browserOptions());
    this.context = await this.browser.newContext({
      storageState: !this.simulation ? config.MAXIMO_BROWSER_STATE : undefined,
    });
    const origin = new URL(this.base).origin;
    await this.context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      return route.continue();
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(12000);
    await this.page.goto(this.base);
    if (this.simulation && this.page.url().includes("/login")) {
      await this.page
        .getByLabel("Username", { exact: true })
        .fill("sim-operator");
      await this.page
        .getByLabel("Password", { exact: true })
        .fill("simulation-only");
      await this.page
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await this.page.waitForURL(this.base + "/");
    }
    await this.checkSession();
    return this.page;
  }
  private async checkSession() {
    if (!this.page || /\/login(?:\?|$)/.test(this.page.url()))
      throw new AppError(
        401,
        "Browser session expired; complete interactive SSO/MFA",
        "SESSION",
      );
  }
  private async unique(selector: string) {
    await this.checkSession();
    const l = this.page!.locator(selector);
    if ((await l.count()) !== 1)
      throw new AppError(
        422,
        `Unknown or ambiguous UI mapping: ${selector}`,
        "MAPPING",
      );
    return l;
  }
  private normalize(value: unknown): RecordData {
    const r = RecordSchema.parse(value);
    if (
      !this.simulation &&
      !config.MAXIMO_SITE_IDS.split(",").filter(Boolean).includes(r.siteId)
    )
      throw new AppError(403, "Record site is outside MAXIMO_SITE_IDS");
    return r;
  }
  async capabilities(): Promise<Capabilities> {
    await this.start();
    return {
      mode: config.MAXIMO_MODE,
      connector: "browser",
      authenticated: true,
      read: true,
      write: this.simulation ? !config.MAXIMO_READ_ONLY : productionPolicy(),
      pmWrite: this.simulation && !config.MAXIMO_READ_ONLY,
      conditional: this.simulation,
      fields: Object.keys(this.mapping.fields),
      limitations: this.simulation
        ? ["Simulation only; fictitious records"]
        : [
            "Deployment selectors require authorized verification",
            "Live browser writes blocked: atomic conditional save has not been verified",
            "Live PM due-date writes disabled",
          ],
      resources: { WO: "Work Order module", PM: "PM module" },
    };
  }
  async search(
    type: "WO" | "PM",
    filters: Record<string, string> = {},
  ): Promise<RecordData[]> {
    const p = await this.start();
    await p.goto(this.base);
    await this.checkSession();
    await (await this.unique(this.mapping.module)).selectOption(type);
    await (await this.unique(this.mapping.site)).fill(filters.siteId ?? "");
    await (await this.unique(this.mapping.query)).fill(filters.q ?? "");
    await (await this.unique(this.mapping.search)).click();
    if (!this.simulation) {
      if (!this.mapping.listData)
        throw new AppError(
          422,
          "Verified structured list extraction mapping is missing",
          "MAPPING",
        );
      return (
        JSON.parse(
          await (await this.unique(this.mapping.listData)).innerText(),
        ) as unknown[]
      ).map((r) => this.normalize(r));
    }
    // Read through the authenticated browser context; writes always use visible UI controls.
    const response = await p.request.get(`${this.base}/api/records/${type}`, {
      params: filters,
    });
    if (!response.ok())
      throw new AppError(response.status(), "Simulator read failed");
    return ((await response.json()) as unknown[]).map((r) => this.normalize(r));
  }
  async read(identity: Identity): Promise<RecordData> {
    Identity.parse(identity);
    const p = await this.start();
    await p.goto(this.base);
    await this.checkSession();
    await (await this.unique(this.mapping.module)).selectOption(identity.type);
    await (await this.unique(this.mapping.site)).fill(identity.siteId);
    await (await this.unique(this.mapping.query)).fill(identity.id);
    await (await this.unique(this.mapping.search)).click();
    if (this.simulation)
      await p.waitForFunction(
        (key) => document.getElementById("records")?.dataset.searchKey === key,
        JSON.stringify({
          type: identity.type,
          site: identity.siteId,
          id: identity.id,
        }),
      );
    const selector = this.mapping.recordButton.replace("{id}", identity.id);
    if (this.simulation && !(await p.locator(selector).count()))
      throw new AppError(404, "Record not found at this site", "NOT_FOUND");
    await p.locator(selector).waitFor({ state: "visible" });
    await (await this.unique(selector)).click();
    await p
      .locator(this.mapping.recordData)
      .filter({ hasText: identity.id })
      .waitFor();
    const record = this.normalize(
      JSON.parse(
        await (await this.unique(this.mapping.recordData)).innerText(),
      ),
    );
    if (recordKey(record) !== recordKey(identity))
      throw new AppError(
        409,
        "Displayed record identity differs from requested identity",
      );
    return record;
  }
  async update(identity: Identity, values: ScheduleValues, revision: string) {
    ScheduleValues.parse(values);
    if (config.MAXIMO_READ_ONLY) throw new AppError(403, "Read-only policy");
    if (!this.simulation)
      throw new AppError(
        403,
        "Live browser updates require deployment-specific atomic conditional-save validation",
        "LIVE_BROWSER_WRITE",
      );
    const current = await this.read(identity);
    validateWrite(identity, values, current);
    if (current.revision !== revision)
      throw new AppError(409, "Record revision changed", "CONFLICT");
    for (const [field, value] of Object.entries(values)) {
      const selector = this.mapping.fields[field];
      if (!selector)
        throw new AppError(
          422,
          `No verified field mapping: ${field}`,
          "MAPPING",
        );
      await (await this.unique(selector)).fill(value ?? "");
    }
    await (await this.unique(this.mapping.save)).click();
    const status = await this.unique(this.mapping.saveStatus);
    await status.filter({ hasText: /Saved|Save error/ }).waitFor();
    const message = await status.innerText();
    if (message.startsWith("Save error"))
      throw new AppError(
        message.includes("changed") ? 409 : 503,
        message,
        "SAVE",
      );
  }
  async labor(): Promise<Labor[]> {
    const p = await this.start();
    if (!this.simulation) {
      if (!this.mapping.laborData)
        throw new AppError(422, "Verified labor mapping is missing");
      return (
        JSON.parse(
          await (await this.unique(this.mapping.laborData)).innerText(),
        ) as unknown[]
      ).map((r) => LaborSchema.parse(r));
    }
    const r = await p.request.get(this.base + "/api/labor");
    if (!r.ok()) throw new AppError(r.status(), "Labor read failed");
    return ((await r.json()) as unknown[]).map((r) => LaborSchema.parse(r));
  }
  async expireForTest() {
    await this.context?.clearCookies();
  }
  async close() {
    await this.browser?.close();
    this.page = undefined;
  }
}

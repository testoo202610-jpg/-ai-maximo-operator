import { readFileSync } from "node:fs";
import { z } from "zod";
import { config, productionPolicy } from "../shared/config.ts";
import {
  AppError,
  RecordSchema,
  LaborSchema,
  recordKey,
  validateWrite,
  type Capabilities,
  type Identity,
  type Labor,
  type MaximoConnector,
  type RecordData,
  type ScheduleValues,
} from "../domain/index.ts";
const resource = z.object({
  list: z.string(),
  record: z.string(),
  collectionKey: z.string().default("member"),
  nextKey: z.string().default("nextPage.href"),
  fields: z.record(z.string(), z.string()),
});
const Mapping = z.object({
  discoveryPath: z.string(),
  resources: z.object({ WO: resource, PM: resource }),
  laborPath: z.string(),
  laborFields: z.record(z.string(), z.string()),
  writeEvidence: z
    .object({
      verifiedInAuthorizedTest: z.boolean(),
      writableFields: z.array(z.string()),
      conditionalETag: z.boolean(),
    })
    .optional(),
});
type Mapping = z.infer<typeof Mapping>;
const at = (value: any, path: string): any =>
  path.split(".").reduce((v, k) => v?.[k], value);
export class RestConnector implements MaximoConnector {
  private mapping: Mapping;
  private base: string;
  private cookie = "";
  private etags = new Map<string, string>();
  private caps?: Capabilities;
  constructor() {
    this.base =
      config.MAXIMO_MODE === "simulation"
        ? config.SIMULATOR_BASE_URL
        : (config.MAXIMO_BASE_URL ?? "");
    if (!this.base) throw new AppError(422, "MAXIMO_BASE_URL is required");
    if (config.MAXIMO_MODE === "simulation")
      this.mapping = {
        discoveryPath: "/api/capabilities",
        resources: {
          WO: {
            list: "/api/records/WO",
            record: "/api/record/WO/{site}/{id}",
            collectionKey: "",
            nextKey: "",
            fields: {},
          },
          PM: {
            list: "/api/records/PM",
            record: "/api/record/PM/{site}/{id}",
            collectionKey: "",
            nextKey: "",
            fields: {},
          },
        },
        laborPath: "/api/labor",
        laborFields: {},
      };
    else {
      if (config.MAXIMO_AUTH_MODE === "session")
        throw new AppError(
          422,
          "REST session authentication requires a deployment-specific adapter; use the browser connector for SSO",
        );
      if (!config.MAXIMO_MAPPING_FILE)
        throw new AppError(422, "Deployment-specific REST mapping is required");
      this.mapping = Mapping.parse(
        JSON.parse(readFileSync(config.MAXIMO_MAPPING_FILE, "utf8")).rest,
      );
    }
  }
  private url(path: string) {
    const u = new URL(path, this.base);
    if (u.origin !== new URL(this.base).origin)
      throw new AppError(
        403,
        "Connector may only access its configured origin",
      );
    return u;
  }
  private async request(path: string, init: RequestInit = {}) {
    if (config.MAXIMO_MODE === "simulation" && !this.cookie) {
      const r = await fetch(this.url("/login"), {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "username=sim-operator&password=simulation-only",
      });
      this.cookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
    }
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (this.cookie) headers.set("Cookie", this.cookie);
    if (config.MAXIMO_API_KEY)
      headers.set(
        config.MAXIMO_AUTH_MODE === "apikey" ? "apikey" : "Authorization",
        config.MAXIMO_AUTH_MODE === "apikey"
          ? config.MAXIMO_API_KEY
          : `Bearer ${config.MAXIMO_API_KEY}`,
      );
    const r = await fetch(this.url(path), {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok)
      throw new AppError(r.status, `Maximo HTTP ${r.status}`, "REMOTE");
    return r;
  }
  async capabilities(): Promise<Capabilities> {
    const r = await this.request(this.mapping.discoveryPath);
    const doc = await r.json();
    const sim = config.MAXIMO_MODE === "simulation";
    const evidence = this.mapping.writeEvidence;
    const write = sim
      ? !config.MAXIMO_READ_ONLY
      : productionPolicy() &&
        !!evidence?.verifiedInAuthorizedTest &&
        !!evidence?.conditionalETag;
    // Deployed discovery documents are retained for inspection; no guessed object structure enables writes.
    this.caps = {
      mode: config.MAXIMO_MODE,
      connector: "rest",
      authenticated: true,
      read: true,
      write,
      pmWrite: sim && write,
      conditional: sim || !!evidence?.conditionalETag,
      fields: sim ? (doc.editableWO ?? []) : (evidence?.writableFields ?? []),
      resources: Object.fromEntries(
        Object.entries(this.mapping.resources).map(([k, v]) => [k, v.list]),
      ),
      limitations: sim
        ? ["Simulation only"]
        : [
            "SBGMax endpoints, field mappings, permissions and ETag behavior require authorized test evidence",
            "PM due-date writes remain disabled",
          ],
    };
    return this.caps;
  }
  private normalize(raw: any, type: "WO" | "PM"): RecordData {
    const map = this.mapping.resources[type].fields;
    const record = Object.keys(map).length
      ? Object.fromEntries(Object.entries(map).map(([k, v]) => [k, at(raw, v)]))
      : raw;
    record.type = type;
    if (!record.id || !record.siteId || !record.revision)
      throw new AppError(422, "Missing mapped identity or revision");
    const sites = config.MAXIMO_SITE_IDS.split(",").filter(Boolean);
    if (
      config.MAXIMO_MODE !== "simulation" &&
      (!sites.length || !sites.includes(record.siteId))
    )
      throw new AppError(403, "Record site is outside MAXIMO_SITE_IDS");
    return RecordSchema.parse(record);
  }
  async search(
    type: "WO" | "PM",
    filters: Record<string, string> = {},
  ): Promise<RecordData[]> {
    const m = this.mapping.resources[type];
    let next: string | undefined = m.list;
    const rows: RecordData[] = [];
    const visited = new Set<string>();
    while (next) {
      if (visited.has(next) || visited.size >= 100)
        throw new AppError(422, "Pagination loop or page limit reached");
      visited.add(next);
      const url = this.url(next);
      if (config.MAXIMO_MODE === "simulation")
        for (const [k, v] of Object.entries(filters))
          url.searchParams.set(k, v);
      const r = await this.request(url.toString());
      const data = await r.json();
      const members = m.collectionKey ? at(data, m.collectionKey) : data;
      if (!Array.isArray(members))
        throw new AppError(422, "Mapped collection is not an array");
      rows.push(...members.map((d) => this.normalize(d, type)));
      if (rows.length > 10000)
        throw new AppError(422, "Record limit reached; narrow the query");
      next = m.nextKey ? at(data, m.nextKey) : undefined;
    }
    // Local filtering avoids interpolating untrusted strings into OSLC expressions. Configure bounded server queries in mapped resource URLs.
    return rows.filter((r) =>
      Object.entries(filters).every(
        ([k, v]) =>
          !v ||
          (k === "q"
            ? `${r.id} ${r.description} ${r.asset}`
                .toLowerCase()
                .includes(v.toLowerCase())
            : k === "unscheduled"
              ? !r.scheduledStart
              : k === "from"
                ? Date.parse(r.due) >= Date.parse(v)
                : k === "to"
                  ? Date.parse(r.due) <= Date.parse(v)
                  : String(r[k as keyof RecordData]) === v),
      ),
    );
  }
  private path(i: Identity) {
    return this.mapping.resources[i.type].record
      .replace("{site}", encodeURIComponent(i.siteId))
      .replace("{id}", encodeURIComponent(i.id));
  }
  async read(i: Identity) {
    const r = await this.request(this.path(i));
    const record = this.normalize(await r.json(), i.type);
    if (recordKey(record) !== recordKey(i))
      throw new AppError(409, "Record identity mismatch");
    const etag = r.headers.get("etag");
    if (etag) this.etags.set(recordKey(i), etag);
    return record;
  }
  async update(i: Identity, v: ScheduleValues, revision: string) {
    const cap = await this.capabilities();
    if (!cap.write || (i.type === "PM" && !cap.pmWrite))
      throw new AppError(403, "Connector write policy denied");
    const before = await this.read(i);
    validateWrite(i, v, before);
    if (before.revision !== revision)
      throw new AppError(409, "External revision changed");
    const sim = config.MAXIMO_MODE === "simulation";
    const etag = this.etags.get(recordKey(i));
    if (!sim && (!etag || etag.startsWith("W/")))
      throw new AppError(403, "Strong conditional update token unavailable");
    if (!sim && Object.keys(v).some((f) => !cap.fields.includes(f)))
      throw new AppError(403, "Field not verified writable");
    const fields = this.mapping.resources[i.type].fields;
    const payload = sim
      ? { values: v, revision }
      : Object.fromEntries(
          Object.entries(v).map(([k, value]) => {
            if (!fields[k] || fields[k].includes("."))
              throw new AppError(
                422,
                "Writable field must have a direct mapping",
              );
            return [fields[k], value];
          }),
        );
    await this.request(this.path(i), {
      method: sim ? "POST" : "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(!sim ? { "If-Match": etag! } : {}),
      },
      body: JSON.stringify(payload),
    });
  }
  async labor(): Promise<Labor[]> {
    const r = await this.request(this.mapping.laborPath);
    const raw = await r.json();
    if (!Array.isArray(raw))
      throw new AppError(422, "Labor collection mapping required");
    const m = this.mapping.laborFields;
    return raw.map((d) =>
      LaborSchema.parse(
        Object.keys(m).length
          ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, at(d, v)]))
          : d,
      ),
    );
  }
}

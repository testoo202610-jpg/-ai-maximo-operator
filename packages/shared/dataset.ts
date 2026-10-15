import type { DatabaseSync } from "node:sqlite";
/** Keep simulator and enterprise data, sessions and approval scopes in separate databases. */
export function bindDataset(
  d: DatabaseSync,
  family: "simulation" | "live",
  endpoint: string | undefined,
) {
  if (!endpoint)
    throw new Error(
      "Live operation requires an authorized MAXIMO_BASE_URL and a separate DATABASE_URL",
    );
  const marker = d
    .prepare("SELECT value FROM settings WHERE key='dataset_family'")
    .get();
  if (marker && marker.value !== family)
    throw new Error(
      "Database mode mismatch: use a separate DATABASE_URL for simulation and live operation",
    );
  const previous = d
    .prepare("SELECT mode,base_url FROM maximo_connections WHERE id=?")
    .get("primary");
  if (
    !marker &&
    previous &&
    (String(previous.mode) === "simulation" ? "simulation" : "live") !== family
  )
    throw new Error(
      "Existing connection data belongs to a different mode; use a separate DATABASE_URL",
    );
  if (!marker && family === "live" && !previous) {
    const records =
      Number(d.prepare("SELECT COUNT(*) n FROM work_orders").get()?.n) +
      Number(d.prepare("SELECT COUNT(*) n FROM pm_records").get()?.n) +
      Number(d.prepare("SELECT COUNT(*) n FROM labor_resources").get()?.n);
    if (records)
      throw new Error(
        "Unclassified cached data cannot be reused for live operation; use a new DATABASE_URL",
      );
  }
  const binding = d
    .prepare("SELECT value FROM settings WHERE key='dataset_endpoint'")
    .get();
  if (
    (binding && binding.value !== endpoint) ||
    (!binding && previous && previous.base_url !== endpoint)
  )
    throw new Error(
      "Database connection mismatch: use a separate DATABASE_URL for another Maximo deployment",
    );
  d.prepare("INSERT OR IGNORE INTO settings VALUES ('dataset_family',?)").run(
    family,
  );
  d.prepare("INSERT OR IGNORE INTO settings VALUES ('dataset_endpoint',?)").run(
    endpoint,
  );
}

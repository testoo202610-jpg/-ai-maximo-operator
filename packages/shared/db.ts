import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.ts";
export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;",
  );
  return d;
}
export const db = openDb(config.DATABASE_URL);
export function migrate(d = db) {
  d.exec(
    "CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)",
  );
  for (const file of readdirSync(resolve("db/migrations")).sort()) {
    if (!d.prepare("SELECT name FROM migrations WHERE name=?").get(file)) {
      d.exec("BEGIN IMMEDIATE");
      try {
        d.exec(readFileSync(resolve("db/migrations", file), "utf8"));
        d.prepare("INSERT INTO migrations VALUES (?,?)").run(
          file,
          new Date().toISOString(),
        );
        d.exec("COMMIT");
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    }
  }
}
export const now = () => new Date().toISOString();
export const json = <T>(value: unknown): T => JSON.parse(String(value)) as T;
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

import { config } from "../../packages/shared/config.ts";
import { openDb } from "../../packages/shared/db.ts";
import { fixtures, labor } from "../../packages/shared/seed.ts";
import {
  AppError,
  validateWrite,
  recordKey,
  type Identity,
  type RecordData,
  type ScheduleValues,
} from "../../packages/domain/index.ts";
export const simDb = openDb(config.SIMULATOR_DATABASE_URL);
simDb.exec(
  `CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sim_sessions(id TEXT PRIMARY KEY,expires INTEGER,role TEXT); CREATE TABLE IF NOT EXISTS faults(key TEXT PRIMARY KEY,kind TEXT NOT NULL);`,
);
export function seedSimulator() {
  for (const r of fixtures())
    simDb
      .prepare("INSERT OR IGNORE INTO records VALUES (?,?)")
      .run(recordKey(r), JSON.stringify(r));
}
export function simRead(i: Identity): RecordData {
  const row = simDb
    .prepare("SELECT data FROM records WHERE key=?")
    .get(recordKey(i));
  if (!row)
    throw new AppError(404, "Record not found at this site", "NOT_FOUND");
  return JSON.parse(String(row.data));
}
export function simSearch(type: string, filters: Record<string, string> = {}) {
  return simDb
    .prepare("SELECT data FROM records")
    .all()
    .map((r) => JSON.parse(String(r.data)) as RecordData)
    .filter((r) => r.type === type)
    .filter((r) =>
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
export function simUpdate(
  i: Identity,
  values: ScheduleValues,
  revision: string,
) {
  simDb.exec("BEGIN IMMEDIATE");
  try {
    const r = simRead(i);
    if (r.revision !== revision)
      throw new AppError(
        409,
        "Record changed; reload before saving",
        "CONFLICT",
      );
    validateWrite(i, values, r);
    const f = simDb
      .prepare("SELECT kind FROM faults WHERE key=?")
      .get(recordKey(i));
    if (f?.kind === "locked")
      throw new AppError(423, "Record is locked by another user", "LOCKED");
    if (
      values.laborId &&
      !labor.some(
        (l) =>
          l.id === values.laborId &&
          l.siteIds.includes(r.siteId) &&
          l.skills.includes(r.skill),
      )
    )
      throw new AppError(400, "Labor skill or site is not permitted");
    const updated = {
      ...r,
      ...values,
      revision: String(Number(r.revision) + 1),
    };
    if (
      updated.type === "WO" &&
      updated.scheduledStart &&
      updated.scheduledFinish &&
      updated.laborId
    ) {
      const conflict = simSearch("WO").some(
        (other) =>
          recordKey(other) !== recordKey(updated) &&
          other.laborId === updated.laborId &&
          other.scheduledStart &&
          other.scheduledFinish &&
          Date.parse(updated.scheduledStart!) <
            Date.parse(other.scheduledFinish) &&
          Date.parse(other.scheduledStart) <
            Date.parse(updated.scheduledFinish!),
      );
      if (conflict)
        throw new AppError(
          409,
          "Labor is already assigned during this interval",
          "LABOR_CONFLICT",
        );
    }
    simDb
      .prepare("UPDATE records SET data=? WHERE key=?")
      .run(JSON.stringify(updated), recordKey(i));
    simDb.exec("COMMIT");
    return { record: updated, ambiguous: f?.kind === "ambiguous" };
  } catch (e) {
    simDb.exec("ROLLBACK");
    throw e;
  }
}

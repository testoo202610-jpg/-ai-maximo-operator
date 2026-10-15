import { createHash, randomUUID } from "node:crypto";
import { db, json, now, transaction } from "../shared/db.ts";
export const hash = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
export function redact(data: unknown): unknown {
  if (typeof data === "string")
    return data
      .replace(/(?:Bearer|apikey)\s+[^\s,]+/gi, "[REDACTED]")
      .replace(
        /(password|token|secret|cookie|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi,
        "$1=[REDACTED]",
      );
  if (Array.isArray(data)) return data.map(redact);
  if (data && typeof data === "object")
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [
        k,
        /password|token|secret|cookie|api.?key|authorization/i.test(k)
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  return data;
}
export function audit(
  actor: string,
  action: string,
  entity: string,
  data: unknown,
) {
  return transaction(() => {
    const previous = db
      .prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1")
      .get() as { hash: string } | undefined;
    const event = {
      id: randomUUID(),
      actor,
      action,
      entity,
      createdAt: now(),
      data: redact(data),
      prevHash: previous?.hash ?? "GENESIS",
    };
    const digest = hash(event);
    db.prepare(
      "INSERT INTO audit_events(id,actor,action,entity,created_at,data,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      event.id,
      actor,
      action,
      entity,
      event.createdAt,
      JSON.stringify(event.data),
      event.prevHash,
      digest,
    );
    return digest;
  });
}
export function auditHistory() {
  return db
    .prepare("SELECT * FROM audit_events ORDER BY seq DESC LIMIT 1000")
    .all()
    .map((r) => ({ ...r, data: json(r.data) }));
}
export function verifyAudit() {
  const rows = db.prepare("SELECT * FROM audit_events ORDER BY seq").all();
  let previous = "GENESIS";
  for (const r of rows) {
    const digest = hash({
      id: r.id,
      actor: r.actor,
      action: r.action,
      entity: r.entity,
      createdAt: r.created_at,
      data: json(r.data),
      prevHash: r.prev_hash,
    });
    if (r.prev_hash !== previous || r.hash !== digest) return false;
    previous = String(r.hash);
  }
  return true;
}

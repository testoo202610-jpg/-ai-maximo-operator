import { randomUUID } from "node:crypto";
import { db, json, now, transaction } from "../shared/db.ts";
import { requirePermission, type User } from "../shared/auth.ts";
import { hash, audit } from "../audit/index.ts";
import { AppError, type Plan, type Change } from "../domain/index.ts";
export function snapshot(changes: Change[]) {
  return hash([...changes].sort((a, b) => a.key.localeCompare(b.key)));
}
export function saveChangeSet(plan: Plan, user: User) {
  requirePermission(user, "plan");
  const id = randomUUID();
  db.prepare(
    "INSERT INTO change_sets(id,plan_id,snapshot_hash,data,status,created_at) VALUES (?,?,?,?,?,?)",
  ).run(
    id,
    plan.id,
    snapshot(plan.changes),
    JSON.stringify(plan.changes),
    "PENDING",
    now(),
  );
  for (const c of plan.changes)
    db.prepare("INSERT INTO change_requests VALUES (?,?,?,?,?,?)").run(
      randomUUID(),
      id,
      c.identity.id,
      c.identity.siteId,
      c.identity.type,
      JSON.stringify(c),
    );
  audit(user.id, "SUBMIT", id, {
    hash: snapshot(plan.changes),
    records: plan.changes.length,
  });
  return id;
}
export function approve(setId: string, keys: string[], user: User) {
  requirePermission(user, "approve");
  if (!keys.length || new Set(keys).size !== keys.length)
    throw new AppError(400, "Select a nonempty unique list of changes");
  const result = transaction(() => {
    const set = db.prepare("SELECT * FROM change_sets WHERE id=?").get(setId);
    if (!set || set.status !== "PENDING")
      throw new AppError(409, "Change set is no longer pending");
    const changes = json<Change[]>(set.data);
    if (snapshot(changes) !== set.snapshot_hash)
      throw new AppError(409, "Change set integrity check failed");
    const selected = changes.filter((c) => keys.includes(c.key));
    if (selected.length !== keys.length)
      throw new AppError(400, "Approval contains unknown change keys");
    const id = randomUUID();
    const expires = new Date(Date.now() + 30 * 60000).toISOString();
    db.prepare("INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      setId,
      snapshot(selected),
      user.id,
      now(),
      expires,
      "APPROVED",
      JSON.stringify(selected),
    );
    db.prepare("UPDATE change_sets SET status='APPROVED' WHERE id=?").run(
      setId,
    );
    return { id, changes: selected, expires };
  });
  audit(user.id, "APPROVE", result.id, {
    changes: result.changes,
    expires: result.expires,
    hash: snapshot(result.changes),
  });
  return result;
}
export function approvedSnapshot(id: string): Change[] {
  const row = db
    .prepare(
      "SELECT a.*,c.status AS set_status,p.status AS plan_status FROM approvals a JOIN change_sets c ON c.id=a.change_set_id JOIN schedule_plans p ON p.id=c.plan_id WHERE a.id=?",
    )
    .get(id);
  if (
    !row ||
    !["APPROVED", "EXECUTING"].includes(String(row.status)) ||
    row.set_status === "CANCELLED" ||
    row.plan_status === "CANCELLED"
  )
    throw new AppError(403, "No active approval for execution", "APPROVAL");
  if (Date.parse(String(row.expires_at)) < Date.now())
    throw new AppError(403, "Approval expired", "EXPIRED");
  const changes = json<Change[]>(row.data);
  if (snapshot(changes) !== row.snapshot_hash)
    throw new AppError(409, "Approval snapshot integrity check failed");
  return changes;
}
export function cancelPlan(id: string, user: User) {
  requirePermission(user, "plan");
  transaction(() => {
    db.prepare("UPDATE schedule_plans SET status='CANCELLED' WHERE id=?").run(
      id,
    );
    db.prepare("UPDATE change_sets SET status='CANCELLED' WHERE plan_id=?").run(
      id,
    );
    db.prepare(
      "UPDATE approvals SET status='CANCELLED' WHERE change_set_id IN (SELECT id FROM change_sets WHERE plan_id=?) AND status IN ('APPROVED','EXECUTING')",
    ).run(id);
    db.prepare(
      "UPDATE execution_jobs SET stop_requested=1 WHERE approval_id IN (SELECT a.id FROM approvals a JOIN change_sets c ON c.id=a.change_set_id WHERE c.plan_id=?)",
    ).run(id);
  });
  audit(user.id, "CANCEL_PLAN", id, {});
}

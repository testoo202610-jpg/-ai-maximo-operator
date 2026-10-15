import { randomUUID } from "node:crypto";
import { db, json, now, transaction } from "../../packages/shared/db.ts";
import { config, productionPolicy } from "../../packages/shared/config.ts";
import { connector } from "../../packages/maximo-adapters/index.ts";
import { approvedSnapshot } from "../../packages/approvals/index.ts";
import { audit, redact } from "../../packages/audit/index.ts";
import {
  AppError,
  exactValues,
  pickValues,
  recordKey,
  validateWrite,
  type Change,
  type Plan,
  type MaximoConnector,
} from "../../packages/domain/index.ts";
import { validatePlan } from "../../packages/scheduler/index.ts";
import { schedulingContext } from "../api/service.ts";
export async function executeJob(id: string, provided?: MaximoConnector) {
  const owner = randomUUID();
  const lease = () => new Date(Date.now() + 90000).toISOString();
  // Serialize operator jobs per connection so independently approved batches
  // cannot race one another's labor-capacity validation.
  const acquired = transaction(() => {
    const lock = db
      .prepare("SELECT * FROM execution_locks WHERE connection_id=?")
      .get("primary");
    if (lock && String(lock.expires_at) > now()) return false;
    const result = db
      .prepare(
        "UPDATE execution_jobs SET status='RUNNING',lease_owner=?,lease_until=?,updated_at=? WHERE id=? AND status IN ('QUEUED','RUNNING') AND (lease_until IS NULL OR lease_until<?)",
      )
      .run(owner, lease(), now(), id, now());
    if (!result.changes) return false;
    db.prepare("INSERT OR REPLACE INTO execution_locks VALUES (?,?,?)").run(
      "primary",
      owner,
      lease(),
    );
    return true;
  });
  if (!acquired) return;
  const heartbeat = setInterval(() => {
    db.prepare(
      "UPDATE execution_jobs SET lease_until=? WHERE id=? AND lease_owner=?",
    ).run(lease(), id, owner);
    db.prepare(
      "UPDATE execution_locks SET expires_at=? WHERE connection_id=? AND owner=?",
    ).run(lease(), "primary", owner);
  }, 15000);
  let c: MaximoConnector | undefined;
  let ambiguous = false;
  try {
    c = provided ?? connector();
    const job = db.prepare("SELECT * FROM execution_jobs WHERE id=?").get(id)!;
    const executor = db
      .prepare("SELECT role_id FROM users WHERE id=?")
      .get(job.requested_by);
    if (
      !executor ||
      !db
        .prepare(
          "SELECT 1 FROM permissions WHERE role_id=? AND action='execute'",
        )
        .get(executor.role_id)
    )
      throw new AppError(403, "Executor permission has been revoked");
    if (
      config.MAXIMO_READ_ONLY ||
      (config.MAXIMO_MODE !== "simulation" && !productionPolicy())
    )
      throw new AppError(403, "Write policy disabled");
    const changes = approvedSnapshot(String(job.approval_id));
    const cap = await c.capabilities();
    if (!cap.write || !cap.conditional)
      throw new AppError(
        403,
        "Connector lacks verified conditional-write capability",
      );
    const approval = db
      .prepare("SELECT approved_by,change_set_id FROM approvals WHERE id=?")
      .get(job.approval_id)!;
    const approver = db
      .prepare("SELECT role_id FROM users WHERE id=?")
      .get(approval.approved_by);
    if (
      !approver ||
      !db
        .prepare(
          "SELECT 1 FROM permissions WHERE role_id=? AND action='approve'",
        )
        .get(approver.role_id)
    )
      throw new AppError(403, "Approver permission has been revoked");
    const planRow = db
      .prepare(
        "SELECT p.data FROM schedule_plans p JOIN change_sets c ON c.plan_id=p.id WHERE c.id=?",
      )
      .get(approval.change_set_id)!;
    const plan = json<Plan>(planRow.data);
    db.prepare("UPDATE approvals SET status='EXECUTING' WHERE id=?").run(
      job.approval_id,
    );
    for (const step of db
      .prepare("SELECT * FROM execution_steps WHERE job_id=? ORDER BY rowid")
      .all(id)) {
      if (step.status === "VERIFIED") continue;
      const state = db
        .prepare(
          "SELECT stop_requested FROM execution_jobs WHERE id=? AND lease_owner=?",
        )
        .get(id, owner);
      if (!state || state.stop_requested) {
        db.prepare(
          "UPDATE execution_steps SET status='CANCELLED' WHERE id=?",
        ).run(step.id);
        continue;
      }
      const change = json<Change>(step.data);
      let updateAttempted = false;
      try {
        const active = approvedSnapshot(String(job.approval_id));
        if (
          !active.some(
            (a) =>
              a.key === change.key &&
              JSON.stringify(a) === JSON.stringify(change),
          ) ||
          !changes.some((a) => a.key === change.key)
        )
          throw new AppError(403, "Step differs from approved snapshot");
        if (
          change.identity.type === "PM" &&
          (config.MAXIMO_MODE !== "simulation" || !cap.pmWrite)
        )
          throw new AppError(403, "PM due-date write policy disabled");
        let current = await c.read(change.identity);
        validateWrite(change.identity, change.after, current);
        if (step.status === "RUNNING" || Number(step.attempts) > 0) {
          if (
            exactValues(
              pickValues(current, Object.keys(change.after)),
              change.after,
            )
          ) {
            db.prepare(
              "UPDATE execution_steps SET status='VERIFIED',result=? WHERE id=?",
            ).run(
              JSON.stringify({
                actual: pickValues(current, Object.keys(change.after)),
                revision: current.revision,
                reconciled: true,
              }),
              step.id,
            );
            audit("runner", "RECONCILED", id, {
              key: change.key,
              actual: change.after,
            });
            continue;
          }
        }
        if (
          current.revision !== change.revision ||
          !exactValues(
            pickValues(current, Object.keys(change.before)),
            change.before,
          )
        )
          throw new AppError(
            409,
            "Authoritative record changed after proposal; new approval required",
            "STALE",
          );
        if (change.identity.type === "WO") {
          const records = await c.search("WO"),
            labor = await c.labor();
          const ctx = { ...schedulingContext(records), labor };
          const item = plan.items.find(
            (i) => recordKey(i.identity) === change.key,
          );
          if (
            !item ||
            !exactValues(
              {
                scheduledStart: item.start,
                scheduledFinish: item.finish,
                laborId: item.laborId,
              },
              change.after,
            )
          )
            throw new AppError(
              409,
              "Approved values do not match the validated schedule item",
            );
          const conflicts = validatePlan([item], plan.parameters, ctx);
          if (conflicts.length)
            throw new AppError(409, conflicts.join("; "), "CONFLICT");
        }
        const stopped = db
          .prepare("SELECT stop_requested FROM execution_jobs WHERE id=?")
          .get(id);
        if (stopped?.stop_requested)
          throw new AppError(409, "Emergency stop requested", "STOP");
        const executionLock = db
          .prepare(
            "SELECT owner,expires_at FROM execution_locks WHERE connection_id=?",
          )
          .get("primary");
        if (
          !executionLock ||
          executionLock.owner !== owner ||
          String(executionLock.expires_at) <= now()
        )
          throw new AppError(
            409,
            "Execution lease was lost; stopping before save",
            "LEASE",
          );
        approvedSnapshot(String(job.approval_id));
        db.prepare(
          "UPDATE execution_steps SET status='RUNNING',attempts=attempts+1 WHERE id=?",
        ).run(step.id);
        updateAttempted = true;
        let saveError: unknown;
        try {
          await c.update(change.identity, change.after, current.revision);
        } catch (e) {
          saveError = e;
        }
        // Always reconcile an ambiguous save before deciding whether any retry is safe.
        try {
          current = await c.read(change.identity);
        } catch {
          ambiguous = true;
          db.prepare(
            "UPDATE execution_steps SET status='UNCERTAIN',result=? WHERE id=?",
          ).run(
            JSON.stringify({
              error:
                "Cannot read back after save; reconcile manually before retry",
            }),
            step.id,
          );
          audit("runner", "UNCERTAIN", id, { key: change.key });
          break;
        }
        const actual = pickValues(current, Object.keys(change.after));
        if (exactValues(actual, change.after)) {
          db.prepare(
            "UPDATE execution_steps SET status='VERIFIED',result=? WHERE id=?",
          ).run(
            JSON.stringify({
              actual,
              revision: current.revision,
              reconciled: !!saveError,
            }),
            step.id,
          );
          audit("runner", "VERIFIED", id, {
            key: change.key,
            before: change.before,
            actual,
            revision: current.revision,
            reconciled: !!saveError,
          });
          const table =
            change.identity.type === "WO" ? "work_orders" : "pm_records";
          db.prepare(
            `UPDATE ${table} SET data=?,external_revision=?,synced_at=? WHERE id=? AND site_id=?`,
          ).run(
            JSON.stringify(current),
            current.revision,
            now(),
            current.id,
            current.siteId,
          );
        } else if (saveError) throw saveError;
        else
          throw new AppError(
            409,
            "Persisted values differ from approved values",
            "VERIFY",
          );
      } catch (e) {
        const conflict = e instanceof AppError && [409, 412].includes(e.status);
        const status = conflict ? "CONFLICT" : "FAILED";
        const error = String(
          redact(e instanceof Error ? e.message : "Execution failed"),
        );
        db.prepare(
          "UPDATE execution_steps SET status=?,result=? WHERE id=?",
        ).run(status, JSON.stringify({ error, updateAttempted }), step.id);
        audit("runner", status, id, { key: change.key, error });
      }
    }
    const statuses = db
      .prepare("SELECT status FROM execution_steps WHERE job_id=?")
      .all(id)
      .map((s) => s.status);
    const stopped = db
      .prepare("SELECT stop_requested FROM execution_jobs WHERE id=?")
      .get(id)?.stop_requested;
    const status = ambiguous
      ? "UNCERTAIN"
      : stopped
        ? "STOPPED"
        : statuses.every((s) => s === "VERIFIED")
          ? "COMPLETED"
          : statuses.some((s) => s === "VERIFIED")
            ? "PARTIAL"
            : "FAILED";
    db.prepare(
      "UPDATE execution_jobs SET status=?,updated_at=? WHERE id=?",
    ).run(status, now(), id);
    db.prepare("UPDATE approvals SET status=? WHERE id=?").run(
      status,
      job.approval_id,
    );
    audit("runner", "EXECUTION_FINISHED", id, { status, counts: statuses });
  } catch (e) {
    const error = String(
      redact(e instanceof Error ? e.message : "Execution failed"),
    );
    db.prepare(
      "UPDATE execution_jobs SET status='FAILED',error=?,updated_at=? WHERE id=?",
    ).run(error, now(), id);
    audit("runner", "EXECUTION_FAILED", id, { error });
  } finally {
    clearInterval(heartbeat);
    db.prepare(
      "UPDATE execution_jobs SET lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?",
    ).run(id, owner);
    db.prepare(
      "DELETE FROM execution_locks WHERE connection_id=? AND owner=?",
    ).run("primary", owner);
    await c?.close?.();
  }
}

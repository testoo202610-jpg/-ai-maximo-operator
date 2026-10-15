import { randomUUID } from "node:crypto";
import { db, json, now } from "../../packages/shared/db.ts";
import { connector } from "../../packages/maximo-adapters/index.ts";
import {
  createPlan,
  validatePlan,
  type Context,
} from "../../packages/scheduler/index.ts";
import { optimizedPlan } from "../../packages/scheduler/optimizer.ts";
import {
  saveChangeSet,
  approvedSnapshot,
} from "../../packages/approvals/index.ts";
import {
  AppError,
  exactValues,
  recordKey,
  Identity,
  pickValues,
  validateWrite,
  type Plan,
  type PlanParams,
  type RecordData,
  type Change,
  type ScheduleValues,
  type MaximoConnector,
} from "../../packages/domain/index.ts";
import { requirePermission, type User } from "../../packages/shared/auth.ts";
import { audit } from "../../packages/audit/index.ts";
import { config, productionPolicy } from "../../packages/shared/config.ts";
export function applyGroups(records: RecordData[]): RecordData[] {
  const mappings = db.prepare("SELECT * FROM color_mappings").all();
  return records.map((r) => {
    const m =
      mappings.find(
        (m) =>
          m.site_id === r.siteId &&
          m.record_type === r.type &&
          m.record_id === r.id,
      ) ??
      mappings.find(
        (m) =>
          m.site_id === r.siteId &&
          r.type === "WO" &&
          m.record_type === "PM" &&
          m.record_id === r.pmId,
      );
    return m ? { ...r, color: String(m.color) } : r;
  });
}
export function cachedRecords(): RecordData[] {
  return applyGroups(
    ["work_orders", "pm_records"].flatMap((table) =>
      db
        .prepare(`SELECT data FROM ${table}`)
        .all()
        .map((r) => json<RecordData>(r.data)),
    ),
  );
}
export async function sync(user: User) {
  requirePermission(user, "read");
  const id = randomUUID();
  db.prepare("INSERT INTO synchronization_runs VALUES (?,?,?,?,?)").run(
    id,
    "RUNNING",
    now(),
    null,
    0,
  );
  let c: MaximoConnector | undefined;
  try {
    c = connector();
    const caps = await c.capabilities();
    const wo = await c.search("WO"),
      pm = await c.search("PM"),
      labor = await c.labor();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM work_orders; DELETE FROM pm_records;");
      for (const old of db.prepare("SELECT id FROM labor_resources").all()) {
        if (!labor.some((l) => l.id === old.id)) {
          db.prepare("DELETE FROM resource_availability WHERE labor_id=?").run(
            old.id,
          );
          db.prepare("DELETE FROM labor_skills WHERE labor_id=?").run(old.id);
          db.prepare("DELETE FROM labor_resources WHERE id=?").run(old.id);
        }
      }
      for (const r of [...wo, ...pm]) {
        Identity.parse(r);
        const mapping = db
          .prepare("SELECT site_id FROM projects WHERE id=?")
          .get(r.project);
        if (mapping && mapping.site_id !== r.siteId)
          throw new AppError(
            409,
            `Project ${r.project} has a different configured site; review mappings before synchronization`,
          );
        const table = r.type === "WO" ? "work_orders" : "pm_records";
        db.prepare(
          `INSERT INTO ${table} VALUES (?,?,?,?,?,?,?) ON CONFLICT(id,site_id) DO UPDATE SET project_id=excluded.project_id,status=excluded.status,external_revision=excluded.external_revision,synced_at=excluded.synced_at,data=excluded.data`,
        ).run(
          r.id,
          r.siteId,
          r.project,
          r.status,
          r.revision,
          now(),
          JSON.stringify(r),
        );
      }
      for (const l of labor) {
        db.prepare(
          "INSERT INTO labor_resources VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data",
        ).run(l.id, l.name, JSON.stringify(l));
        db.prepare("DELETE FROM labor_skills WHERE labor_id=?").run(l.id);
        for (const skill of l.skills)
          db.prepare("INSERT INTO labor_skills VALUES (?,?)").run(l.id, skill);
      }
      db.prepare(
        "INSERT OR REPLACE INTO maximo_connections VALUES (?,?,?,?)",
      ).run(
        "primary",
        config.MAXIMO_MODE,
        config.MAXIMO_BASE_URL ?? config.SIMULATOR_BASE_URL,
        config.MAXIMO_AUTH_MODE,
      );
      db.prepare("INSERT INTO connector_capabilities VALUES (?,?,?)").run(
        "primary",
        now(),
        JSON.stringify(caps),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    db.prepare(
      "UPDATE synchronization_runs SET status='COMPLETED',finished_at=?,records=? WHERE id=?",
    ).run(now(), wo.length + pm.length, id);
    audit(user.id, "SYNCHRONIZE", id, { records: wo.length + pm.length, caps });
    return { id, records: wo.length + pm.length, capabilities: caps };
  } catch (e) {
    db.prepare(
      "UPDATE synchronization_runs SET status='FAILED',finished_at=? WHERE id=?",
    ).run(now(), id);
    throw e;
  } finally {
    await c?.close?.();
  }
}
export function schedulingContext(records = cachedRecords()): Context {
  const rules = Object.fromEntries(
    db
      .prepare("SELECT * FROM schedule_rules")
      .all()
      .map((r) => [
        String(r.building),
        {
          minutes: Number(r.minutes),
          jobPlanPrecedence: !!r.job_plan_precedence,
        },
      ]),
  );
  const shifts = db
    .prepare("SELECT * FROM shifts")
    .all()
    .map((r) => ({
      id: Number(r.id),
      startHour: Number(r.start_hour),
      hours: Number(r.hours),
    }));
  const calendar = db
    .prepare("SELECT value FROM settings WHERE key='calendar'")
    .get();
  return {
    records: applyGroups(records),
    rules,
    shifts,
    labor: db
      .prepare("SELECT data FROM labor_resources")
      .all()
      .map((r) => json(r.data)),
    ...(calendar
      ? json<{ holidays: string[]; restrictedBuildings: string[] }>(
          calendar.value,
        )
      : { holidays: [], restrictedBuildings: [] }),
    availability: db
      .prepare("SELECT * FROM resource_availability")
      .all()
      .map((r) => ({
        laborId: String(r.labor_id),
        start: String(r.start_at),
        finish: String(r.end_at),
      })),
  };
}
export function getPlan(id: string): Plan {
  const r = db.prepare("SELECT * FROM schedule_plans WHERE id=?").get(id);
  if (!r) throw new AppError(404, "Plan not found");
  return json<Plan>(r.data);
}
export function persistPlan(plan: Plan, user: User) {
  db.prepare("INSERT INTO schedule_plans VALUES (?,?,?,?,?)").run(
    plan.id,
    "DRAFT",
    JSON.stringify(plan),
    user.id,
    now(),
  );
  for (const i of plan.items)
    db.prepare("INSERT INTO schedule_items VALUES (?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      plan.id,
      i.identity.id,
      i.identity.siteId,
      i.start,
      i.finish,
      i.laborId,
      JSON.stringify(i),
    );
  audit(user.id, "CREATE_PLAN", plan.id, {
    scheduled: plan.items.length,
    unscheduled: plan.unscheduled.length,
    solver: plan.solver,
  });
  return plan;
}
export async function planSchedule(params: PlanParams, user: User) {
  requirePermission(user, "plan");
  if (!cachedRecords().length) await sync(user);
  const ctx = schedulingContext();
  const plan = config.OPTIMIZER_URL
    ? await optimizedPlan(params, ctx)
    : createPlan(params, ctx);
  return persistPlan(plan, user);
}
export function submit(id: string, user: User) {
  const row = db
    .prepare("SELECT status FROM schedule_plans WHERE id=?")
    .get(id);
  if (row?.status !== "DRAFT")
    throw new AppError(409, "Only a draft plan can be submitted");
  const plan = getPlan(id);
  if (!plan.changes.length)
    throw new AppError(422, "Plan has no executable changes");
  const conflicts = plan.items.length
    ? validatePlan(plan.items, plan.parameters, schedulingContext())
    : [];
  if (conflicts.length) throw new AppError(409, conflicts.join("; "));
  const setId = saveChangeSet(plan, user);
  db.prepare("UPDATE schedule_plans SET status='SUBMITTED' WHERE id=?").run(id);
  return { changeSetId: setId };
}
export function adjustPlan(
  id: string,
  key: string,
  start: string,
  laborId: string,
  user: User,
) {
  requirePermission(user, "plan");
  const row = db
    .prepare("SELECT status FROM schedule_plans WHERE id=?")
    .get(id);
  if (row?.status !== "DRAFT")
    throw new AppError(
      409,
      "Only draft plans may be adjusted; create a new proposal after submission",
    );
  const plan = getPlan(id),
    item = plan.items.find((i) => recordKey(i.identity) === key);
  if (!item) throw new AppError(404, "Plan item not found");
  item.start = new Date(start).toISOString();
  item.finish = new Date(
    Date.parse(start) + item.minutes * 60000,
  ).toISOString();
  item.laborId = laborId;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(start)),
  );
  item.shift =
    schedulingContext().shifts.find(
      (s) => hour >= s.startHour && hour < s.startHour + s.hours,
    )?.id ?? -1;
  const conflicts = validatePlan(
    plan.items,
    plan.parameters,
    schedulingContext(),
  );
  if (conflicts.length) throw new AppError(409, conflicts.join("; "));
  const change = plan.changes.find((c) => c.key === key)!;
  change.after = {
    scheduledStart: item.start,
    scheduledFinish: item.finish,
    laborId,
  };
  change.reason += "; manually adjusted by " + user.id;
  plan.workload = {};
  for (const i of plan.items)
    plan.workload[i.laborId] = (plan.workload[i.laborId] ?? 0) + i.minutes;
  db.prepare("UPDATE schedule_plans SET data=? WHERE id=?").run(
    JSON.stringify(plan),
    id,
  );
  db.prepare(
    "UPDATE schedule_items SET data=?,start_at=?,finish_at=?,labor_id=? WHERE plan_id=? AND record_id=? AND site_id=?",
  ).run(
    JSON.stringify(item),
    item.start,
    item.finish,
    item.laborId,
    id,
    item.identity.id,
    item.identity.siteId,
  );
  audit(user.id, "ADJUST_PLAN", id, { key, after: change.after });
  return plan;
}
export async function proposePM(
  identity: Identity,
  values: ScheduleValues,
  reason: string,
  user: User,
) {
  requirePermission(user, "plan");
  if (config.MAXIMO_MODE !== "simulation")
    throw new AppError(
      403,
      "Live PM due-date writes are disabled until separately validated and authorized",
    );
  const c = connector();
  try {
    const r = await c.read(identity);
    if (r.type !== "PM")
      throw new AppError(400, "PM workflow requires a PM record");
    validateWrite(identity, values, r);
    const change: Change = {
      key: recordKey(r),
      identity,
      description: r.description,
      revision: r.revision,
      before: pickValues(r, Object.keys(values)),
      after: values,
      reason,
      conflicts: [],
      pmImpact: `Simulation rule preview: next generation reference would be ${r.extendedDate ?? values.nextDue}. Extended date ${r.extendedDate ?? "none"}; frequency ${r.frequency}; hierarchy ${r.hierarchy}; forecast ${r.forecast}. WO generation is not run. No frequency or hierarchy write.`,
    };
    const p: Plan = {
      id: randomUUID(),
      parameters: {
        startDate: String(values.nextDue).slice(0, 10),
        days: 1,
        startTime: "08:00",
        colorSeparation: false,
        includeScheduled: false,
      },
      items: [],
      changes: [change],
      conflicts: [],
      unscheduled: [],
      workload: {},
      explanations: [change.pmImpact],
      solver: "PM-due-date-proposal",
    };
    return persistPlan(p, user);
  } finally {
    await c.close?.();
  }
}
export function enqueue(approvalId: string, user: User) {
  requirePermission(user, "execute");
  if (
    config.MAXIMO_READ_ONLY ||
    (config.MAXIMO_MODE !== "simulation" && !productionPolicy())
  )
    throw new AppError(403, "Server-side write policy is disabled");
  const existing = db
    .prepare("SELECT id,status FROM execution_jobs WHERE approval_id=?")
    .get(approvalId);
  if (existing)
    return { id: existing.id, status: existing.status, idempotent: true };
  const changes = approvedSnapshot(approvalId),
    id = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO execution_jobs(id,approval_id,status,created_at,updated_at,requested_by) VALUES (?,?,?,?,?,?)",
    ).run(id, approvalId, "QUEUED", now(), now(), user.id);
    for (const change of changes)
      db.prepare(
        "INSERT INTO execution_steps(id,job_id,change_key,status,data) VALUES (?,?,?,?,?)",
      ).run(randomUUID(), id, change.key, "PENDING", JSON.stringify(change));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  audit(user.id, "QUEUE_EXECUTION", id, {
    approvalId,
    records: changes.length,
  });
  return { id, status: "QUEUED", idempotent: false };
}
export function report(id: string) {
  const job = db.prepare("SELECT * FROM execution_jobs WHERE id=?").get(id);
  if (!job) throw new AppError(404, "Execution not found");
  const steps = db
    .prepare("SELECT * FROM execution_steps WHERE job_id=? ORDER BY rowid")
    .all(id)
    .map((s) => ({
      ...s,
      status: String(s.status),
      data: json(s.data),
      result: s.result ? json(s.result) : null,
    }));
  return {
    job,
    steps,
    summary: steps.reduce<Record<string, number>>(
      (acc, s) => ({
        ...acc,
        [String(s.status)]: (acc[String(s.status)] ?? 0) + 1,
      }),
      {},
    ),
    mode: config.MAXIMO_MODE,
    liveVerified:
      config.MAXIMO_MODE !== "simulation" &&
      steps.some((s) => s.status === "VERIFIED"),
  };
}

export async function verifyExecution(id: string, user: User) {
  requirePermission(user, "read");
  const r = report(id);
  const con = connector();
  const outcomes = [];
  try {
    for (const s of r.steps) {
      const change = s.data as Change;
      try {
        const actual = await con.read(change.identity);
        outcomes.push({
          key: change.key,
          matches: exactValues(
            pickValues(actual, Object.keys(change.after)),
            change.after,
          ),
          actual: pickValues(actual, Object.keys(change.after)),
        });
      } catch {
        outcomes.push({
          key: change.key,
          matches: false,
          error: "Read-back unavailable",
        });
      }
    }
    audit(user.id, "REVERIFY", id, outcomes);
    return { outcomes };
  } finally {
    await con.close?.();
  }
}

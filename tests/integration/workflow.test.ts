import { beforeAll, beforeEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db, json } from "../../packages/shared/db.ts";
import { seed, fixtures, labor } from "../../packages/shared/seed.ts";
import {
  simDb,
  seedSimulator,
  simRead,
  simSearch,
  simUpdate,
} from "../../apps/simulator/store.ts";
import {
  approve,
  approvedSnapshot,
  cancelPlan,
} from "../../packages/approvals/index.ts";
import { createPlan } from "../../packages/scheduler/index.ts";
import {
  persistPlan,
  submit,
  enqueue,
  report,
} from "../../apps/api/service.ts";
import { executeJob } from "../../apps/operator-runner/engine.ts";
import {
  login,
  session,
  requirePermission,
  type User,
} from "../../packages/shared/auth.ts";
import { audit, verifyAudit } from "../../packages/audit/index.ts";
import { config } from "../../packages/shared/config.ts";
import { context, params } from "../fixtures/context.ts";
import {
  AppError,
  type Identity,
  type MaximoConnector,
  type ScheduleValues,
} from "../../packages/domain/index.ts";
const supervisor: User = {
    id: "supervisor",
    name: "Local Supervisor",
    role_id: "supervisor",
  },
  planner: User = { id: "planner", name: "Planner", role_id: "planner" };
class StoreConnector implements MaximoConnector {
  async capabilities() {
    return {
      mode: "simulation",
      connector: "test-store",
      authenticated: true,
      read: true,
      write: true,
      pmWrite: true,
      conditional: true,
      fields: ["scheduledStart", "scheduledFinish", "laborId", "nextDue"],
      limitations: [],
      resources: {},
    };
  }
  async search(type: "WO" | "PM", filters = {}) {
    return simSearch(type, filters);
  }
  async read(i: Identity) {
    return simRead(i);
  }
  async update(i: Identity, v: ScheduleValues, revision: string) {
    const result = simUpdate(i, v, revision);
    if (result.ambiguous) throw new AppError(503, "Ambiguous save");
  }
  async labor() {
    return labor;
  }
}
function batch(count = 2) {
  const c = context();
  c.records = fixtures();
  const p = createPlan({ ...params, colorSeparation: false }, c);
  p.items = p.items.slice(0, count);
  p.changes = p.changes.filter((c) =>
    p.items.some((i) => i.identity.id === c.identity.id),
  );
  persistPlan(p, supervisor);
  const s = submit(p.id, supervisor);
  const a = approve(
    s.changeSetId,
    p.changes.map((c) => c.key),
    supervisor,
  );
  return { p, s, a };
}
beforeAll(() => {
  seed();
  seedSimulator();
});
beforeEach(() => {
  for (const table of [
    "execution_locks",
    "execution_steps",
    "execution_jobs",
    "approvals",
    "change_requests",
    "change_sets",
    "schedule_items",
    "schedule_plans",
    "audit_events",
    "color_mappings",
  ])
    db.exec(`DELETE FROM ${table}`);
  simDb.exec("DELETE FROM records; DELETE FROM faults;");
  seedSimulator();
  for (const r of fixtures()) {
    const table = r.type === "WO" ? "work_orders" : "pm_records";
    db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?,?,?,?,?,?,?)`).run(
      r.id,
      r.siteId,
      r.project,
      r.status,
      r.revision,
      new Date().toISOString(),
      JSON.stringify(r),
    );
  }
});
describe("approval and execution policy", () => {
  it("blocks unapproved execution and missing roles", () => {
    expect(() => enqueue(randomUUID(), supervisor)).toThrow("approval");
    const p = createPlan(params, context());
    persistPlan(p, supervisor);
    const s = submit(p.id, supervisor);
    expect(() =>
      approve(
        s.changeSetId,
        p.changes.map((c) => c.key),
        planner,
      ),
    ).toThrow("Permission");
    expect(() => enqueue(randomUUID(), planner)).toThrow("Permission");
  });
  it("binds approval to the exact selected subset and hashes", () => {
    const { a } = batch();
    expect(approvedSnapshot(a.id)).toHaveLength(2);
    db.prepare("UPDATE approvals SET data=? WHERE id=?").run(
      JSON.stringify([{ ...a.changes[0], after: { status: "CLOSE" } }]),
      a.id,
    );
    expect(() => approvedSnapshot(a.id)).toThrow("integrity");
  });
  it("expires approvals and cancels pending plans", () => {
    const { a, p } = batch();
    db.prepare("UPDATE approvals SET expires_at=? WHERE id=?").run(
      "2000-01-01T00:00:00Z",
      a.id,
    );
    expect(() => enqueue(a.id, supervisor)).toThrow("expired");
    cancelPlan(p.id, supervisor);
    expect(() => approvedSnapshot(a.id)).toThrow("active approval");
  });
  it("executes and verifies persisted values, with duplicate queue attempts idempotent", async () => {
    const { a, p } = batch();
    const job = enqueue(a.id, supervisor);
    expect(enqueue(a.id, supervisor)).toMatchObject({
      id: job.id,
      idempotent: true,
    });
    await executeJob(String(job.id), new StoreConnector());
    expect(report(String(job.id)).job.status).toBe("COMPLETED");
    for (const c of p.changes)
      expect(simRead(c.identity)).toMatchObject(c.after);
    expect(report(String(job.id)).summary.VERIFIED).toBe(2);
    expect(verifyAudit()).toBe(true);
    await executeJob(String(job.id), new StoreConnector());
    expect(simRead(p.changes[0].identity).revision).toBe("2");
  });
  it("rejects changed external revisions and reports a partial batch", async () => {
    const { a, p } = batch();
    const current = simRead(p.changes[0].identity);
    simDb
      .prepare("UPDATE records SET data=? WHERE key=?")
      .run(JSON.stringify({ ...current, revision: "99" }), p.changes[0].key);
    const job = enqueue(a.id, supervisor);
    await executeJob(String(job.id), new StoreConnector());
    const r = report(String(job.id));
    expect(r.job.status).toBe("PARTIAL");
    expect(r.summary.CONFLICT).toBe(1);
    expect(r.summary.VERIFIED).toBe(1);
  });
  it("reconciles ambiguous saves before retry and does not duplicate the save", async () => {
    const { a, p } = batch(1);
    simDb
      .prepare("INSERT INTO faults VALUES (?,?)")
      .run(p.changes[0].key, "ambiguous");
    const job = enqueue(a.id, supervisor);
    await executeJob(String(job.id), new StoreConnector());
    expect(report(String(job.id)).summary.VERIFIED).toBe(1);
    expect(simRead(p.changes[0].identity).revision).toBe("2");
    const result = json<any>(
      db
        .prepare("SELECT result FROM execution_steps WHERE job_id=?")
        .get(job.id)!.result,
    );
    expect(result.reconciled).toBe(true);
  });
  it("recovers a process interruption after persistence using read-back", async () => {
    const { a, p } = batch(1),
      job = enqueue(a.id, supervisor);
    const c = p.changes[0];
    simUpdate(c.identity, c.after, c.revision);
    db.prepare(
      "UPDATE execution_steps SET status='RUNNING',attempts=1 WHERE job_id=?",
    ).run(job.id);
    await executeJob(String(job.id), new StoreConnector());
    expect(report(String(job.id)).summary.VERIFIED).toBe(1);
    expect(simRead(c.identity).revision).toBe("2");
  });
  it("stops remaining records without writing them", async () => {
    const { a, p } = batch(),
      job = enqueue(a.id, supervisor);
    db.prepare("UPDATE execution_jobs SET stop_requested=1 WHERE id=?").run(
      job.id,
    );
    await executeJob(String(job.id), new StoreConnector());
    expect(report(String(job.id)).job.status).toBe("STOPPED");
    expect(simRead(p.changes[0].identity).revision).toBe("1");
  });
  it("marks a read-back failure UNCERTAIN and stops the rest of the batch", async () => {
    const { a } = batch(),
      job = enqueue(a.id, supervisor);
    const c = new StoreConnector();
    let saved = false;
    const original = c.update.bind(c);
    c.update = async (...args) => {
      await original(...args);
      saved = true;
    };
    const read = c.read.bind(c);
    c.read = async (i) => {
      if (saved) throw new Error("Network lost");
      return read(i);
    };
    await executeJob(String(job.id), c);
    expect(report(String(job.id)).job.status).toBe("UNCERTAIN");
    expect(report(String(job.id)).summary.PENDING).toBe(1);
  });
  it("enforces deny-by-default production writes and explicit read-only mode", () => {
    const { a } = batch();
    const original = config.MAXIMO_MODE;
    config.MAXIMO_MODE = "live-approved";
    try {
      expect(() => enqueue(a.id, supervisor)).toThrow("write policy");
    } finally {
      config.MAXIMO_MODE = original;
    }
    config.MAXIMO_READ_ONLY = true;
    try {
      expect(() => enqueue(a.id, supervisor)).toThrow("write policy");
    } finally {
      config.MAXIMO_READ_ONLY = false;
    }
  });
  it("filters PM and WO records by project, site and unscheduled state", async () => {
    const c = new StoreConnector();
    const wo = await c.search("WO", {
      project: "1611",
      siteId: "HARAM",
      unscheduled: "true",
    });
    expect(wo.length).toBeGreaterThan(5);
    expect(
      wo.every(
        (r) => r.type === "WO" && r.project === "1611" && r.siteId === "HARAM",
      ),
    ).toBe(true);
    expect(
      (await c.search("PM", { siteId: "NORTH" })).every(
        (r) => r.siteId === "NORTH",
      ),
    ).toBe(true);
    expect(() =>
      simRead({ type: "WO", id: wo[0].id, siteId: "NORTH" }),
    ).toThrow("not found");
  });
  it("uses server sessions and rejects password guesses", () => {
    expect(() => login("supervisor", "wrong")).toThrow("Invalid credentials");
    const r = login("supervisor", "local-demo");
    expect(session(r.token)?.id).toBe("supervisor");
    expect(() =>
      requirePermission(
        { id: "viewer", name: "viewer", role_id: "viewer" },
        "execute",
      ),
    ).toThrow("Permission");
  });
  it("detects audit tampering", () => {
    audit("supervisor", "TEST", "record", { safe: true });
    expect(verifyAudit()).toBe(true);
    db.prepare("UPDATE audit_events SET data='{}'").run();
    expect(verifyAudit()).toBe(false);
  });
});
describe("execution failure isolation", () => {
  it("records a lock failure and continues only independently safe records", async () => {
    const { a, p } = batch(2),
      job = enqueue(a.id, supervisor);
    simDb
      .prepare("INSERT INTO faults VALUES (?,?)")
      .run(p.changes[0].key, "locked");
    await executeJob(String(job.id), new StoreConnector());
    const r = report(String(job.id));
    expect(r.job.status).toBe("PARTIAL");
    expect(r.summary.FAILED).toBe(1);
    expect(r.summary.VERIFIED).toBe(1);
    expect(simRead(p.changes[0].identity).revision).toBe("1");
  });
  it("rejects changed original values even if a remote revision was not incremented", async () => {
    const { a, p } = batch(1),
      job = enqueue(a.id, supervisor);
    const current = simRead(p.changes[0].identity);
    simDb
      .prepare("UPDATE records SET data=? WHERE key=?")
      .run(JSON.stringify({ ...current, laborId: "L-02" }), p.changes[0].key);
    await executeJob(String(job.id), new StoreConnector());
    expect(report(String(job.id)).summary.CONFLICT).toBe(1);
  });
  it("revalidates current executor privileges before saving", async () => {
    const { a, p } = batch(1),
      job = enqueue(a.id, supervisor);
    db.prepare("UPDATE users SET role_id='viewer' WHERE id='supervisor'").run();
    try {
      await executeJob(String(job.id), new StoreConnector());
      expect(report(String(job.id)).job.status).toBe("FAILED");
      expect(simRead(p.changes[0].identity).revision).toBe("1");
    } finally {
      db.prepare(
        "UPDATE users SET role_id='supervisor' WHERE id='supervisor'",
      ).run();
    }
  });
  it("read-only live mode blocks writes even when the general production flag is set", () => {
    const { a } = batch(1);
    config.MAXIMO_MODE = "live-readonly";
    config.MAXIMO_PRODUCTION_WRITE_ENABLED = true;
    try {
      expect(() => enqueue(a.id, supervisor)).toThrow("write policy");
    } finally {
      config.MAXIMO_MODE = "simulation";
      config.MAXIMO_PRODUCTION_WRITE_ENABLED = false;
    }
  });
});
it("serializes independent jobs per connection before labor validation", async () => {
  const first = batch(1),
    second = batch(1),
    j1 = enqueue(first.a.id, supervisor),
    j2 = enqueue(second.a.id, supervisor);
  const running = executeJob(String(j1.id), new StoreConnector());
  await executeJob(String(j2.id), new StoreConnector());
  expect(report(String(j2.id)).job.status).toBe("QUEUED");
  await running;
  await executeJob(String(j2.id), new StoreConnector());
  expect(report(String(j1.id)).job.status).toBe("COMPLETED");
  expect(report(String(j2.id)).summary.CONFLICT).toBe(1);
});
it("rejects a lost connection execution lease before submitting a save", async () => {
  const { a, p } = batch(1),
    job = enqueue(a.id, supervisor),
    c = new StoreConnector();
  const search = c.search.bind(c);
  c.search = async (type, filters) => {
    db.prepare("UPDATE execution_locks SET owner='another-worker'").run();
    return search(type, filters);
  };
  await executeJob(String(job.id), c);
  expect(report(String(job.id)).summary.CONFLICT).toBe(1);
  expect(simRead(p.changes[0].identity).revision).toBe("1");
});

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { config } from "../../packages/shared/config.ts";
import { db, json, now } from "../../packages/shared/db.ts";
import { seed } from "../../packages/shared/seed.ts";
import {
  login,
  logout,
  session,
  requirePermission,
  type User,
} from "../../packages/shared/auth.ts";
import {
  audit,
  auditHistory,
  verifyAudit,
  redact,
} from "../../packages/audit/index.ts";
import { approve, cancelPlan } from "../../packages/approvals/index.ts";
import {
  AppError,
  Identity,
  PlanParams,
  ScheduleValues,
  type Plan,
  type RecordData,
} from "../../packages/domain/index.ts";
import { understand, type Command } from "../../packages/ai-agent/index.ts";
import { connector } from "../../packages/maximo-adapters/index.ts";
import {
  sync,
  cachedRecords,
  planSchedule,
  getPlan,
  submit,
  adjustPlan,
  enqueue,
  report,
  verifyExecution,
  proposePM,
  schedulingContext,
} from "./service.ts";
import { validatePlan } from "../../packages/scheduler/index.ts";
seed();
const app = new Hono<{ Variables: { user: User } }>();
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 1000000,
    onError: (c) => c.json({ error: "Request too large" }, 413),
  }),
);
app.onError((e, c) => {
  const validation = e instanceof z.ZodError;
  if (!validation && !(e instanceof AppError))
    console.error(
      JSON.stringify({
        event: "operator_error",
        name: e.name,
        message: redact(e.message),
      }),
    );
  return c.json(
    {
      error: validation
        ? "Invalid request: " +
          e.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")
        : redact(
            e instanceof AppError
              ? e.message
              : "Internal error; inspect local service configuration",
          ),
      code: e instanceof AppError ? e.code : validation ? "INPUT" : "INTERNAL",
    },
    (e instanceof AppError ? e.status : validation ? 400 : 500) as 400,
  );
});
const rates = new Map<string, { start: number; count: number }>();
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  if (process.env.NODE_ENV === "production")
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
  if (c.req.path.startsWith("/api")) {
    const cookie = getCookie(c, "operator_session");
    const key = cookie?.slice(0, 24) ?? "anonymous";
    const current = rates.get(key);
    const bucket =
      !current || Date.now() - current.start > 60000
        ? { start: Date.now(), count: 0 }
        : current;
    if (++bucket.count > 240)
      return c.json({ error: "Rate limit exceeded" }, 429);
    rates.set(key, bucket);
    if (rates.size > 10000) rates.clear();
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (
        origin &&
        origin !== config.APP_ORIGIN &&
        origin !== `http://${config.HOST}:${config.PORT}`
      )
        return c.json({ error: "Origin denied" }, 403);
      if (!c.req.header("content-type")?.startsWith("application/json"))
        return c.json({ error: "JSON content type required" }, 415);
      if (Number(c.req.header("content-length") ?? 0) > 1000000)
        return c.json({ error: "Request too large" }, 413);
    }
  }
  await next();
});
app.get("/api/health", (c) =>
  c.json({ ok: true, mode: config.MAXIMO_MODE, service: "AI Maximo Operator" }),
);
app.post("/api/login", async (c) => {
  const b = z
    .object({
      username: z.enum(["supervisor", "planner", "viewer"]),
      password: z.string().max(200),
    })
    .parse(await c.req.json());
  const result = login(b.username, b.password);
  setCookie(c, "operator_session", result.token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: config.APP_ORIGIN.startsWith("https:"),
    path: "/",
    maxAge: 28800,
  });
  audit(result.user.id, "LOGIN", result.user.id, {});
  return c.json(result.user);
});
app.use("/api/*", async (c, next) => {
  const user = session(getCookie(c, "operator_session"));
  if (!user) return c.json({ error: "Sign in required" }, 401);
  c.set("user", user);
  requirePermission(user, "read");
  await next();
});
app.get("/api/me", (c) => c.json(c.get("user")));
app.post("/api/logout", (c) => {
  logout(getCookie(c, "operator_session")!);
  deleteCookie(c, "operator_session");
  return c.json({ ok: true });
});
app.get("/api/dashboard", (c) => {
  const records = cachedRecords(),
    wo = records.filter(
      (r) => r.type === "WO" && !["COMP", "CLOSE", "CAN"].includes(r.status),
    ),
    pm = records.filter((r) => r.type === "PM");
  const cap = db
    .prepare(
      "SELECT * FROM connector_capabilities ORDER BY discovered_at DESC LIMIT 1",
    )
    .get();
  return c.json({
    mode: config.MAXIMO_MODE,
    connector: config.MAXIMO_CONNECTOR_MODE,
    user: c.get("user"),
    readOnly: config.MAXIMO_READ_ONLY || config.MAXIMO_MODE === "live-readonly",
    productionWriteEnabled: config.MAXIMO_PRODUCTION_WRITE_ENABLED,
    connection: cap
      ? { ...json<any>(cap.data), checkedAt: cap.discovered_at }
      : null,
    openWO: wo.length,
    pmDue: pm.filter(
      (r) => Date.parse(r.nextDue ?? r.due) <= Date.now() + 7 * 86400000,
    ).length,
    overdue: wo.filter((r) => Date.parse(r.due) < Date.now()).length,
    pendingApprovals: Number(
      db
        .prepare("SELECT COUNT(*) n FROM change_sets WHERE status='PENDING'")
        .get()?.n,
    ),
    failures: Number(
      db
        .prepare(
          "SELECT COUNT(*) n FROM execution_steps WHERE status IN ('FAILED','CONFLICT','UNCERTAIN')",
        )
        .get()?.n,
    ),
    recent: db
      .prepare("SELECT * FROM execution_jobs ORDER BY created_at DESC LIMIT 5")
      .all(),
  });
});
app.post("/api/sync", async (c) => c.json(await sync(c.get("user"))));
app.get("/api/records", (c) => {
  const f = c.req.query();
  return c.json(
    cachedRecords().filter((r) =>
      Object.entries(f).every(
        ([k, v]) =>
          !v ||
          (k === "q"
            ? `${r.id} ${r.description} ${r.asset} ${r.location}`
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
    ),
  );
});
app.get("/api/records/:type/:site/:id", async (c) => {
  const i = Identity.parse({
    type: c.req.param("type"),
    siteId: c.req.param("site"),
    id: c.req.param("id"),
  });
  const con = connector();
  try {
    return c.json(await con.read(i));
  } finally {
    await con.close?.();
  }
});
app.get("/api/plans", (c) =>
  c.json(
    db
      .prepare("SELECT * FROM schedule_plans ORDER BY created_at DESC LIMIT 30")
      .all()
      .map((p) => ({ ...p, data: json(p.data) })),
  ),
);
app.get("/api/plans/:id", (c) => c.json(getPlan(c.req.param("id"))));
app.post("/api/plans", async (c) =>
  c.json(
    await planSchedule(PlanParams.parse(await c.req.json()), c.get("user")),
  ),
);
app.post("/api/plans/:id/submit", (c) =>
  c.json(submit(c.req.param("id"), c.get("user"))),
);
app.post("/api/plans/:id/cancel", (c) => {
  cancelPlan(c.req.param("id"), c.get("user"));
  return c.json({ ok: true });
});
app.post("/api/plans/:id/adjust", async (c) => {
  const b = z
    .object({
      key: z.string(),
      start: z.iso.datetime({ offset: true }),
      laborId: z.string(),
    })
    .parse(await c.req.json());
  return c.json(
    adjustPlan(c.req.param("id"), b.key, b.start, b.laborId, c.get("user")),
  );
});
app.post("/api/pm-proposals", async (c) => {
  const b = z
    .object({
      identity: Identity,
      values: ScheduleValues,
      reason: z.string().min(5).max(1000),
    })
    .strict()
    .parse(await c.req.json());
  return c.json(await proposePM(b.identity, b.values, b.reason, c.get("user")));
});
app.get("/api/approvals", (c) =>
  c.json({
    sets: db
      .prepare("SELECT * FROM change_sets ORDER BY created_at DESC LIMIT 50")
      .all()
      .map((s) => ({ ...s, data: json(s.data) })),
    approvals: db
      .prepare("SELECT * FROM approvals ORDER BY approved_at DESC LIMIT 50")
      .all()
      .map((a) => ({ ...a, data: json(a.data) })),
  }),
);
app.post("/api/approvals", async (c) => {
  const b = z
    .object({
      changeSetId: z.string().uuid(),
      keys: z.array(z.string()).min(1).max(500),
    })
    .strict()
    .parse(await c.req.json());
  return c.json(approve(b.changeSetId, b.keys, c.get("user")));
});
app.post("/api/approvals/:id/reject", (c) => {
  requirePermission(c.get("user"), "approve");
  const a = db
    .prepare("SELECT plan_id FROM change_sets WHERE id=?")
    .get(c.req.param("id"));
  if (!a) throw new AppError(404, "Change set not found");
  cancelPlan(String(a.plan_id), c.get("user"));
  audit(c.get("user").id, "REJECT", c.req.param("id"), {});
  return c.json({ ok: true });
});
app.post("/api/execute", async (c) => {
  const b = z
    .object({ approvalId: z.string().uuid() })
    .strict()
    .parse(await c.req.json());
  return c.json(enqueue(b.approvalId, c.get("user")));
});
app.get("/api/jobs", (c) =>
  c.json(
    db
      .prepare("SELECT * FROM execution_jobs ORDER BY created_at DESC LIMIT 50")
      .all(),
  ),
);
app.get("/api/jobs/:id", (c) => c.json(report(c.req.param("id"))));
app.post("/api/jobs/:id/stop", (c) => {
  requirePermission(c.get("user"), "execute");
  db.prepare("UPDATE execution_jobs SET stop_requested=1 WHERE id=?").run(
    c.req.param("id"),
  );
  audit(c.get("user").id, "EMERGENCY_STOP", c.req.param("id"), {});
  return c.json({ ok: true });
});
app.post("/api/stop", (c) => {
  requirePermission(c.get("user"), "execute");
  db.prepare(
    "UPDATE execution_jobs SET stop_requested=1 WHERE status IN ('QUEUED','RUNNING')",
  ).run();
  audit(c.get("user").id, "EMERGENCY_STOP_ALL", "all", {});
  return c.json({ ok: true });
});
app.post("/api/jobs/:id/verify", async (c) =>
  c.json(await verifyExecution(c.req.param("id"), c.get("user"))),
);
app.get("/api/jobs/:id/report", (c) => {
  c.header(
    "Content-Disposition",
    `attachment; filename="execution-${c.req.param("id")}.json"`,
  );
  return c.json(report(c.req.param("id")));
});
app.get("/api/audit", (c) =>
  c.json({ events: auditHistory(), chainValid: verifyAudit() }),
);
app.get("/api/audit/export", (c) => {
  c.header("Content-Disposition", 'attachment; filename="audit.json"');
  return c.json({ events: auditHistory(), chainValid: verifyAudit() });
});
app.get("/api/settings", (c) =>
  c.json({
    mode: config.MAXIMO_MODE,
    connector: config.MAXIMO_CONNECTOR_MODE,
    timezone: "Asia/Riyadh",
    aiProvider: config.AI_PROVIDER,
    aiModel: config.AI_MODEL || "Deterministic bilingual parser",
    readOnly: config.MAXIMO_READ_ONLY,
    productionWriteEnabled: config.MAXIMO_PRODUCTION_WRITE_ENABLED,
    shifts: db.prepare("SELECT * FROM shifts").all(),
    rules: db.prepare("SELECT * FROM schedule_rules").all(),
    projects: db.prepare("SELECT * FROM projects").all(),
    calendar: schedulingContext().holidays,
    labor: schedulingContext().labor,
    groups: db.prepare("SELECT * FROM color_mappings").all(),
  }),
);
app.post("/api/settings/rules", async (c) => {
  requirePermission(c.get("user"), "settings");
  const rules = z
    .array(
      z.object({
        building: z.string().max(80),
        minutes: z.number().int().min(5).max(480),
        jobPlanPrecedence: z.boolean(),
      }),
    )
    .max(30)
    .parse(await c.req.json());
  for (const r of rules)
    db.prepare("INSERT OR REPLACE INTO schedule_rules VALUES (?,?,?)").run(
      r.building,
      r.minutes,
      Number(r.jobPlanPrecedence),
    );
  audit(c.get("user").id, "UPDATE_RULES", "rules", rules);
  return c.json({ ok: true });
});
app.post("/api/settings/shifts", async (c) => {
  requirePermission(c.get("user"), "settings");
  const shifts = z
    .array(
      z.object({
        id: z.number().int().min(1).max(3),
        name: z.string().max(50),
        startHour: z.number().int().min(0).max(23),
        hours: z.number().int().min(1).max(12),
      }),
    )
    .length(3)
    .parse(await c.req.json());
  if (
    new Set(shifts.map((s) => s.id)).size !== 3 ||
    shifts.some((s) => s.startHour + s.hours > 24)
  )
    throw new AppError(
      400,
      "Use three distinct shifts within a calendar day; split overnight coverage at midnight",
    );
  for (const s of shifts)
    db.prepare("INSERT OR REPLACE INTO shifts VALUES (?,?,?,?)").run(
      s.id,
      s.name,
      s.startHour,
      s.hours,
    );
  audit(c.get("user").id, "UPDATE_SHIFTS", "shifts", shifts);
  return c.json({ ok: true });
});
app.post("/api/settings/projects", async (c) => {
  requirePermission(c.get("user"), "settings");
  const mappings = z
    .array(
      z.object({
        id: z.enum(["1610", "1611", "1612", "1613"]),
        siteId: z.string().regex(/^[\w-]{1,40}$/),
        name: z.string().min(1).max(80),
      }),
    )
    .max(4)
    .parse(await c.req.json());
  for (const m of mappings) {
    db.prepare("INSERT OR IGNORE INTO sites VALUES (?,?)").run(
      m.siteId,
      m.siteId,
    );
    db.prepare("UPDATE projects SET name=?,site_id=? WHERE id=?").run(
      m.name,
      m.siteId,
      m.id,
    );
  }
  audit(c.get("user").id, "PROJECT_MAPPING", "projects", mappings);
  return c.json({ ok: true });
});
app.post("/api/settings/calendar", async (c) => {
  requirePermission(c.get("user"), "settings");
  const b = z
    .object({
      holidays: z.array(z.iso.date()).max(500),
      restrictedBuildings: z.array(z.string().max(80)).max(100),
    })
    .strict()
    .parse(await c.req.json());
  db.prepare("INSERT OR REPLACE INTO settings VALUES ('calendar',?)").run(
    JSON.stringify(b),
  );
  audit(c.get("user").id, "CALENDAR", "calendar", b);
  return c.json({ ok: true });
});
app.post("/api/groups", async (c) => {
  requirePermission(c.get("user"), "plan");
  const b = z
    .object({
      confirmed: z.literal(true),
      mappings: z
        .array(
          z.object({
            identity: Identity,
            color: z.enum(["blue", "green", "amber", "violet", "red"]),
            source: z.string().min(1).max(80),
          }),
        )
        .min(1)
        .max(500),
    })
    .strict()
    .parse(await c.req.json());
  for (const m of b.mappings) {
    if (
      !cachedRecords().some(
        (r) =>
          r.type === m.identity.type &&
          r.id === m.identity.id &&
          r.siteId === m.identity.siteId,
      )
    )
      throw new AppError(404, "Color mapping record or site not found");
  }
  for (const m of b.mappings)
    db.prepare(
      "INSERT OR REPLACE INTO color_mappings VALUES (?,?,?,?,?,?,?)",
    ).run(
      m.identity.type,
      m.identity.id,
      m.identity.siteId,
      m.color,
      m.source,
      c.get("user").id,
      now(),
    );
  audit(c.get("user").id, "CONFIRM_GROUPS", "color-mappings", b.mappings);
  return c.json({ ok: true, count: b.mappings.length });
});
async function invoke(command: Command, user: User): Promise<any> {
  switch (command.tool) {
    case "get_connection_status":
    case "discover_maximo_capabilities": {
      requirePermission(user, "read");
      const c = connector();
      try {
        return await c.capabilities();
      } finally {
        await c.close?.();
      }
    }
    case "search_work_orders":
    case "search_pm_records": {
      requirePermission(user, "read");
      if (!cachedRecords().length) await sync(user);
      return cachedRecords()
        .filter(
          (r) =>
            r.type === (command.tool === "search_pm_records" ? "PM" : "WO"),
        )
        .filter((r) =>
          Object.entries(command.filters).every(([k, v]) =>
            k === "unscheduled"
              ? !r.scheduledStart
              : String(r[k as keyof RecordData]) === v,
          ),
        );
    }
    case "create_schedule_plan":
      return planSchedule(command.parameters, user);
    case "preview_changes":
      requirePermission(user, "read");
      return getPlan(command.planId).changes;
    case "detect_schedule_conflicts": {
      requirePermission(user, "read");
      const p = getPlan(command.planId);
      return {
        conflicts: validatePlan(p.items, p.parameters, schedulingContext()),
        unscheduled: p.unscheduled,
      };
    }
    case "get_scheduling_rules":
      requirePermission(user, "read");
      return schedulingContext().rules;
    case "get_labor_availability":
      requirePermission(user, "read");
      return schedulingContext().labor;
    case "execute_approved_changes":
      return enqueue(command.approvalId, user);
    case "verify_changes":
      return verifyExecution(command.executionId, user);
    case "generate_execution_report":
      requirePermission(user, "read");
      return report(command.executionId);
  }
}
app.post("/api/chat", async (c) => {
  const b = z
    .object({
      message: z.string().min(1).max(4000),
      startDate: z.iso.date().optional(),
      planId: z.string().uuid().optional(),
    })
    .strict()
    .parse(await c.req.json());
  const previous = b.planId ? getPlan(b.planId) : undefined;
  const command = await understand(b.message, {
    ...b,
    parameters: previous?.parameters,
  });
  const result = await invoke(command, c.get("user"));
  const eventId = randomUUID();
  audit(c.get("user").id, "AGENT_TOOL", eventId, {
    tool: command.tool,
    command,
  });
  const plan = result?.changes && result?.items ? (result as Plan) : undefined;
  return c.json({
    command,
    result,
    plan,
    message: plan
      ? `تم إنشاء مقترح يتضمن ${plan.items.length} مهمة، و${plan.unscheduled.length} تحتاج مراجعة. لم يتم تعديل Maximo. / Review and approve the exact changes before execution.`
      : Array.isArray(result)
        ? `تم استرجاع ${result.length} سجل من البيانات المتزامنة. / ${result.length} records retrieved.`
        : "تم تنفيذ أداة القراءة بنجاح. / Tool result is available.",
  });
});
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));
serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST });
console.log(`Operator API: http://${config.HOST}:${config.PORT}`);

import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { BrowserConnector } from "../../packages/maximo-adapters/browser.ts";
import { RestConnector } from "../../packages/maximo-adapters/rest.ts";
test("Arabic instruction → PM read → plan → human approval → Playwright write → persisted verification → report", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("local-demo");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("عمليات");
  await page
    .getByRole("button", { name: "المشغّل الذكي", exact: true })
    .click();
  await page
    .getByLabel("Operator instruction")
    .fill("ادخل على Maximo واستخرج كل أوامر PM المفتوحة في المطاف.");
  await page.getByRole("button", { name: "Send instruction" }).click();
  await expect(page.locator(".tool-result code").first()).toHaveText(
    "search_pm_records()",
  );
  await expect(page.locator(".chat-records").first()).toContainText("PM-");
  await page
    .getByLabel("Operator instruction")
    .fill(
      "جدول كل PM في المطاف لمدة 15 دقيقة، وابدأ الساعة الثامنة صباحًا. كل لون يكون في يوم مختلف.",
    );
  await page.getByRole("button", { name: "Send instruction" }).click();
  await expect(page.locator(".tool-result code").last()).toHaveText(
    "create_schedule_plan()",
  );
  await page.getByRole("button", { name: "مراجعة الخطة" }).click();
  await expect(page.locator(".calendar-task").first()).toBeVisible();
  const plans = await (await page.request.get("/api/plans")).json();
  const plan = plans[0].data;
  expect(plan.items.length).toBeGreaterThan(3);
  const days = new Map<string, Set<string>>();
  for (const item of plan.items) {
    const d = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh",
    }).format(new Date(item.start));
    days.set(d, new Set([...(days.get(d) ?? []), item.color]));
  }
  expect([...days.values()].every((s) => s.size === 1)).toBe(true);
  // The API refuses an invented approval even when the current UI user is a supervisor.
  const unapproved = await page.request.post("/api/execute", {
    data: { approvalId: "11111111-1111-4111-8111-111111111111" },
  });
  expect(unapproved.status()).toBe(403);
  await page.getByRole("button", { name: "إرسال للموافقة" }).click();
  await expect(
    page.getByRole("heading", { name: "مركز الموافقات", exact: true }),
  ).toBeVisible();
  const boxes = page.getByRole("checkbox", { name: /Approve WO-/ });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: /أوافق على القيم المحددة/ }).click();
  await expect(
    page.getByRole("button", { name: "تنفيذ المعتمد فقط" }).first(),
  ).toBeEnabled();
  await page.getByRole("button", { name: "تنفيذ المعتمد فقط" }).first().click();
  await expect
    .poll(
      async () => {
        const jobs = await (await page.request.get("/api/jobs")).json();
        return jobs[0]?.status;
      },
      { timeout: 120000, intervals: [1000, 2000] },
    )
    .toBe("COMPLETED");
  const jobs = await (await page.request.get("/api/jobs")).json(),
    result = await (await page.request.get("/api/jobs/" + jobs[0].id)).json();
  expect(result.summary.VERIFIED).toBe(2);
  expect(result.mode).toBe("simulation");
  const reverified = await (
    await page.request.post(`/api/jobs/${jobs[0].id}/verify`, { data: {} })
  ).json();
  expect(reverified.outcomes.every((o: any) => o.matches)).toBe(true);
  expect(result.liveVerified).toBe(false);
  const simulator = new DatabaseSync(process.env.SIMULATOR_DATABASE_URL!);
  for (const step of result.steps) {
    const row = simulator
      .prepare("SELECT data FROM records WHERE key=?")
      .get(step.data.key)!;
    expect(JSON.parse(String(row.data))).toMatchObject(step.data.after);
  }
  const untouched = plan.changes.filter(
    (c: any) => !result.steps.some((s: any) => s.change_key === c.key),
  );
  expect(untouched.length).toBeGreaterThan(0);
  const row = simulator
    .prepare("SELECT data FROM records WHERE key=?")
    .get(untouched[0].key)!;
  expect(JSON.parse(String(row.data)).scheduledStart).toBe(null);
  simulator.close();
  const response = await page.request.get(
    "/api/jobs/" + jobs[0].id + "/report",
  );
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-disposition"]).toContain("attachment");
  const audit = await (await page.request.get("/api/audit")).json();
  expect(audit.chainValid).toBe(true);
  expect(
    audit.events.filter((e: any) => e.action === "VERIFIED").length,
  ).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Clarity",
  );
  await page.screenshot({ path: "data/demo-dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "data/demo-mobile.png", fullPage: true });
});
test("real browser session expiration, record mismatch and simulator save faults", async () => {
  const c = new BrowserConnector();
  try {
    const caps = await c.capabilities();
    expect(caps.authenticated).toBe(true);
    const records = await c.search("WO", { project: "1610" }),
      r = records.find((r) => r.materialsReady && !r.scheduledStart)!;
    const identity = { type: "WO" as const, id: r.id, siteId: r.siteId };
    await expect(c.read({ ...identity, siteId: "NORTH" })).rejects.toThrow();
    const db = new DatabaseSync(process.env.SIMULATOR_DATABASE_URL!);
    db.prepare("INSERT OR REPLACE INTO faults VALUES (?,?)").run(
      `WO:${r.siteId}:${r.id}`,
      "ambiguous",
    );
    const values = {
      scheduledStart: "2026-10-25T05:00:00.000Z",
      scheduledFinish: "2026-10-25T05:30:00.000Z",
      laborId: "L-01",
    };
    await expect(c.update(identity, values, r.revision)).rejects.toThrow(
      "Save error",
    );
    const actual = await c.read(identity);
    expect(actual).toMatchObject(values);
    expect(actual.revision).toBe("2");
    db.prepare("DELETE FROM faults").run();
    db.close();
    await c.expireForTest();
    await expect(c.read(identity)).rejects.toThrow("session expired");
  } finally {
    await c.close();
  }
});
test("REST adapter reads, conditionally saves and verifies against the real simulator server", async () => {
  const c = new RestConnector();
  const caps = await c.capabilities();
  expect(caps.write).toBe(true);
  const records = await c.search("WO", { project: "1613" });
  const r = records.find((r) => r.materialsReady && !r.scheduledStart)!;
  const identity = { type: "WO" as const, id: r.id, siteId: r.siteId };
  const values = {
    scheduledStart: "2026-10-27T05:00:00.000Z",
    scheduledFinish: "2026-10-27T05:30:00.000Z",
    laborId: "L-03",
  };
  await c.update(identity, values, r.revision);
  expect(await c.read(identity)).toMatchObject(values);
  await expect(c.update(identity, values, r.revision)).rejects.toThrow(
    "revision",
  );
});
test("backend rejects viewer writes and cross-origin requests", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Account", { exact: true }).selectOption("viewer");
  await page.getByLabel("Password", { exact: true }).fill("local-demo");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("عمليات");
  const denied = await page.request.post("/api/plans", {
    data: { project: "1611", startDate: "2026-10-19" },
  });
  expect(denied.status()).toBe(403);
  const cross = await page.request.post("/api/settings/calendar", {
    headers: { Origin: "https://untrusted.example" },
    data: { holidays: [], restrictedBuildings: [] },
  });
  expect(cross.status()).toBe(403);
});
test("PM due-date proposal uses a distinct approved browser execution without WO scheduling writes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("local-demo");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("عمليات");
  const records = await (
    await page.request.get("/api/records?type=PM&project=1612")
  ).json();
  const record = records[0];
  const identity = { type: "PM", id: record.id, siteId: record.siteId };
  const proposed = "2026-10-29T08:00:00+03:00";
  const response = await page.request.post("/api/pm-proposals", {
    data: {
      identity,
      values: { nextDue: proposed },
      reason: "Authorized simulation PM due-date review",
    },
  });
  expect(response.ok()).toBe(true);
  const plan = await response.json();
  expect(plan.items).toHaveLength(0);
  expect(plan.changes[0].pmImpact).toContain("generation");
  const submitted = await (
    await page.request.post(`/api/plans/${plan.id}/submit`, { data: {} })
  ).json();
  const approval = await (
    await page.request.post("/api/approvals", {
      data: {
        changeSetId: submitted.changeSetId,
        keys: plan.changes.map((c: any) => c.key),
      },
    })
  ).json();
  const job = await (
    await page.request.post("/api/execute", {
      data: { approvalId: approval.id },
    })
  ).json();
  await expect
    .poll(
      async () => {
        const r = await (await page.request.get("/api/jobs/" + job.id)).json();
        return r.job.status;
      },
      { timeout: 60000 },
    )
    .toBe("COMPLETED");
  const fresh = await (
    await page.request.get(`/api/records/PM/${record.siteId}/${record.id}`)
  ).json();
  expect(fresh.nextDue).toBe(proposed);
  expect(fresh.frequency).toBe(record.frequency);
  expect(fresh.scheduledStart).toBe(null);
});
test("successful synchronization removes records and labor no longer returned by the authoritative source", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Password", { exact: true }).fill("local-demo");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("عمليات");
  const database = new DatabaseSync(process.env.DATABASE_URL!);
  const existing = database.prepare("SELECT * FROM work_orders LIMIT 1").get()!;
  const stale = { ...JSON.parse(String(existing.data)), id: "WO-REMOVED" };
  database
    .prepare("INSERT INTO work_orders VALUES (?,?,?,?,?,?,?)")
    .run(
      stale.id,
      stale.siteId,
      stale.project,
      stale.status,
      stale.revision,
      new Date().toISOString(),
      JSON.stringify(stale),
    );
  database.prepare("INSERT INTO labor_resources VALUES (?,?,?)").run(
    "L-REMOVED",
    "Removed fictitious resource",
    JSON.stringify({
      id: "L-REMOVED",
      name: "Removed fictitious resource",
      skills: [],
      siteIds: [],
      shifts: [],
      unavailableDates: [],
    }),
  );
  database.close();
  const result = await page.request.post("/api/sync", { data: {} });
  expect(result.ok()).toBe(true);
  const records = await (
    await page.request.get("/api/records?q=WO-REMOVED")
  ).json();
  expect(records).toHaveLength(0);
  const settings = await (await page.request.get("/api/settings")).json();
  expect(settings.labor.some((l: any) => l.id === "L-REMOVED")).toBe(false);
});

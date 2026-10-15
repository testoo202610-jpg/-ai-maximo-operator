import { describe, it, expect } from "vitest";
import { context, params } from "../fixtures/context.ts";
import {
  createPlan,
  validatePlan,
  riyadhDay,
  duration,
} from "../../packages/scheduler/index.ts";
import { recordKey } from "../../packages/domain/index.ts";
describe("deterministic scheduling constraints", () => {
  it("keeps each confirmed color on its own Riyadh calendar day", () => {
    const ctx = context(),
      p = createPlan(params, ctx);
    expect(p.items.length).toBeGreaterThan(5);
    const days = new Map<string, Set<string>>();
    for (const i of p.items) {
      const d = riyadhDay(i.start);
      days.set(d, new Set([...(days.get(d) ?? []), i.color!]));
    }
    expect([...days.values()].every((c) => c.size === 1)).toBe(true);
    expect(new Set(p.items.map((i) => i.color)).size).toBe(3);
    expect(validatePlan(p.items, p.parameters, ctx)).toEqual([]);
  });
  it("does not assign unknown colors and explains material shortages", () => {
    const p = createPlan(params, context());
    expect(p.unscheduled.some((u) => u.reason.includes("unknown"))).toBe(true);
    expect(p.unscheduled.some((u) => u.reason.includes("materials"))).toBe(
      true,
    );
  });
  it("honors building duration estimates and approved job-plan precedence", () => {
    const ctx = context(),
      r = ctx.records.find((r) => r.type === "WO" && r.project === "1611")!;
    r.duration = 45;
    expect(duration(r, { ...params, durationOverride: 20 }, ctx)).toBe(45);
    ctx.rules.MATAF.jobPlanPrecedence = false;
    expect(duration(r, { ...params, durationOverride: 20 }, ctx)).toBe(20);
  });
  it("enforces shifts and requested 08:00 reference", () => {
    const ctx = context(),
      p = createPlan({ ...params, colorSeparation: false }, ctx);
    for (const i of p.items) {
      const s = Date.parse(i.start),
        f = Date.parse(i.finish),
        shift = ctx.shifts.find((s) => s.id === i.shift)!;
      const start = Date.parse(
        riyadhDay(i.start) +
          `T${String(shift.startHour).padStart(2, "0")}:00:00+03:00`,
      );
      expect(s).toBeGreaterThanOrEqual(start);
      expect(f).toBeLessThanOrEqual(start + shift.hours * 3600000);
      expect(s).toBeGreaterThanOrEqual(Date.parse("2026-10-19T08:00:00+03:00"));
    }
  });
  it("explains no qualified labor without inventing technicians", () => {
    const ctx = context();
    ctx.labor = [];
    const p = createPlan(params, ctx);
    expect(p.items).toHaveLength(0);
    expect(p.unscheduled.length).toBeGreaterThan(0);
    expect(p.unscheduled.some((u) => u.reason.includes("required skill"))).toBe(
      true,
    );
  });
  it("respects holidays and explicit labor unavailability", () => {
    const ctx = context();
    ctx.holidays = ["2026-10-19"];
    ctx.labor.forEach((l) => (l.unavailableDates = ["2026-10-20"]));
    const p = createPlan({ ...params, colorSeparation: false }, ctx);
    expect(
      p.items.every(
        (i) => !["2026-10-19", "2026-10-20"].includes(riyadhDay(i.start)),
      ),
    ).toBe(true);
  });
  it("reserves existing work and independently rejects overlapping proposals", () => {
    const ctx = context(),
      p = createPlan({ ...params, colorSeparation: false }, ctx);
    const [a, b] = p.items.filter((i) => i.laborId === "L-01");
    b.start = a.start;
    b.finish = a.finish;
    b.minutes = a.minutes;
    expect(validatePlan(p.items, p.parameters, ctx)).toContain(
      "Labor resource overlap",
    );
  });
  it("excludes a technician outside explicit availability windows", () => {
    const ctx = context();
    ctx.availability = ctx.labor.map((l) => ({
      laborId: l.id,
      start: "2026-11-01T08:00:00+03:00",
      finish: "2026-11-01T16:00:00+03:00",
    }));
    expect(createPlan(params, ctx).items).toHaveLength(0);
  });
  it("does not schedule buildings with active restrictions", () => {
    const ctx = context();
    ctx.restrictedBuildings = ["MATAF"];
    expect(createPlan(params, ctx).items).toHaveLength(0);
  });
  it("uses Asia/Riyadh rather than UTC calendar boundaries", () => {
    expect(riyadhDay("2026-10-19T22:00:00Z")).toBe("2026-10-20");
  });
  it("requires a bounded horizon and valid date", () => {
    expect(() => createPlan({ ...params, days: 99 }, context())).toThrow();
    expect(() =>
      createPlan({ ...params, startDate: "yesterday" }, context()),
    ).toThrow();
  });
  it("handles all projects while preserving site-aware identities", () => {
    const ctx = context(),
      p = createPlan(
        { ...params, project: undefined, colorSeparation: false },
        ctx,
      );
    expect(new Set(p.items.map((i) => i.identity.siteId)).size).toBe(2);
    expect(new Set(p.items.map((i) => recordKey(i.identity))).size).toBe(
      p.items.length,
    );
  });
});
it("keeps PM-linked instructions from scheduling unrelated corrective WOs", () => {
  const ctx = context(),
    unlinked = ctx.records.find(
      (r) => r.type === "WO" && r.project === "1611",
    )!;
  unlinked.pmId = null;
  const p = createPlan({ ...params, pmLinkedOnly: true }, ctx);
  expect(p.items.some((i) => i.identity.id === unlinked.id)).toBe(false);
});
it("enforces authoritative earliest-start and latest-finish hard windows", () => {
  const ctx = context();
  ctx.records
    .filter((r) => r.type === "WO" && r.project === "1611")
    .forEach((r) => {
      r.earliestStart = "2026-10-22T08:00:00+03:00";
      r.latestFinish = "2026-10-22T09:00:00+03:00";
    });
  const p = createPlan({ ...params, colorSeparation: false }, ctx);
  expect(p.items.length).toBeGreaterThan(0);
  expect(
    p.items.every(
      (i) =>
        Date.parse(i.start) >= Date.parse("2026-10-22T08:00:00+03:00") &&
        Date.parse(i.finish) <= Date.parse("2026-10-22T09:00:00+03:00"),
    ),
  ).toBe(true);
});

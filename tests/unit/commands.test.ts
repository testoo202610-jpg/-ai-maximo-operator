import { describe, it, expect } from "vitest";
import { parseCommand, Command } from "../../packages/ai-agent/index.ts";
import {
  Identity,
  ScheduleValues,
  validateWrite,
} from "../../packages/domain/index.ts";
import { fixtures } from "../../packages/shared/seed.ts";
import { redact } from "../../packages/audit/index.ts";
describe("Arabic and English typed commands", () => {
  it("parses Arabic PM scheduling with Arabic numerals and separate colors", () => {
    const c = parseCommand(
      "جدول كل PM في المطاف لمدة ١٥ دقيقة، وابدأ الساعة الثامنة صباحًا. كل لون يكون في يوم مختلف.",
      { startDate: "2026-10-19" },
    );
    expect(c.tool).toBe("create_schedule_plan");
    if (c.tool === "create_schedule_plan")
      expect(c.parameters).toMatchObject({
        project: "1611",
        durationOverride: 15,
        startTime: "08:00",
        colorSeparation: true,
      });
  });
  it("parses explicit English date and time", () => {
    const c = parseCommand(
      "Schedule project 1612 for 60 min on 2026-10-25 at 16:00",
    );
    if (c.tool !== "create_schedule_plan") throw Error("wrong tool");
    expect(c.parameters).toMatchObject({
      project: "1612",
      startDate: "2026-10-25",
      startTime: "16:00",
      durationOverride: 60,
    });
  });
  it("retrieves PM rather than changing PM generation settings", () => {
    expect(
      parseCommand("ادخل على Maximo واستخرج كل أوامر PM المفتوحة في المطاف."),
    ).toEqual({
      tool: "search_pm_records",
      filters: { project: "1611", status: "ACTIVE" },
    });
  });
  it("finds unscheduled work orders", () => {
    expect(parseCommand("اعرض جميع أوامر العمل التي لم تتم جدولتها.")).toEqual({
      tool: "search_work_orders",
      filters: { unscheduled: "true" },
    });
  });
  it("requires separate review for PM due-date commands", () => {
    expect(() =>
      parseCommand("غيّر موعد PM رقم 12345 إلى يوم 25 أكتوبر."),
    ).toThrow("PM due-date");
  });
  it("cannot grant its own approval or issue browser commands", () => {
    expect(() => parseCommand("نفذ التعديلات التي وافقت عليها فقط.")).toThrow(
      "Approval Center",
    );
    expect(() =>
      Command.parse({ tool: "browser_eval", code: "delete all" }),
    ).toThrow();
    expect(() => Command.parse({ tool: "approve_all" })).toThrow();
  });
  it("rejects invalid identities and arbitrary field writes", () => {
    expect(() =>
      Identity.parse({ type: "WO", id: "../../admin", siteId: "HARAM" }),
    ).toThrow();
    expect(() => ScheduleValues.parse({ status: "CLOSE" })).toThrow();
  });
  it("separates PM from WO writes and blocks cross-site records", () => {
    const wo = fixtures().find((r) => r.type === "WO")!,
      pm = fixtures().find((r) => r.type === "PM")!;
    expect(() =>
      validateWrite(wo, { nextDue: "2026-10-25T05:00:00Z" }, wo),
    ).toThrow("prohibited");
    expect(() =>
      validateWrite(pm, { scheduledStart: "2026-10-25T05:00:00Z" }, pm),
    ).toThrow("prohibited");
    expect(() =>
      validateWrite({ ...wo, siteId: "OTHER" }, { laborId: "L-01" }, wo),
    ).toThrow("site mismatch");
  });
  it("blocks PM writes when generation behavior is unknown", () => {
    const pm = {
      ...fixtures().find((r) => r.type === "PM")!,
      pmBehaviorVerified: false,
    };
    expect(() =>
      validateWrite(pm, { nextDue: "2026-10-25T05:00:00Z" }, pm),
    ).toThrow("unknown");
  });
  it("redacts nested credentials and bearer strings", () => {
    const r = JSON.stringify(
      redact({
        authorization: "Bearer abc",
        nested: { api_key: "SECRET" },
        message: "token=SECRET cookie=COOKIE Bearer xyz",
      }),
    );
    expect(r).not.toContain("SECRET");
    expect(r).not.toContain("COOKIE");
    expect(r).not.toContain("xyz");
  });
});
it("keeps project and duration context for a follow-up color-separation instruction", () => {
  const c = parseCommand("كل لون يكون في يوم مختلف.", {
    planId: "11111111-1111-4111-8111-111111111111",
    parameters: {
      project: "1611",
      startDate: "2026-10-19",
      days: 7,
      startTime: "08:00",
      colorSeparation: false,
      includeScheduled: false,
      durationOverride: 15,
      pmLinkedOnly: true,
    },
  });
  expect(c.tool).toBe("create_schedule_plan");
  if (c.tool === "create_schedule_plan")
    expect(c.parameters).toMatchObject({
      project: "1611",
      durationOverride: 15,
      pmLinkedOnly: true,
      colorSeparation: true,
      startDate: "2026-10-19",
    });
});

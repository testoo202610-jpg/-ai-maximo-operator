import {
  AppError,
  PlanParams,
  recordKey,
  pickValues,
  type Plan,
  type RecordData,
  type Labor,
  type ScheduleItem,
  type Change,
} from "../domain/index.ts";
import { randomUUID } from "node:crypto";
export type Context = {
  records: RecordData[];
  labor: Labor[];
  rules: Record<string, { minutes: number; jobPlanPrecedence: boolean }>;
  shifts: { id: number; startHour: number; hours: number }[];
  holidays: string[];
  restrictedBuildings: string[];
  availability?: { laborId: string; start: string; finish: string }[];
};
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function riyadhDay(iso: string) {
  return dayFormatter.format(new Date(iso));
}
export function addDays(day: string, n: number) {
  return new Date(Date.parse(day + "T12:00:00+03:00") + n * 86400_000)
    .toISOString()
    .slice(0, 10);
}
const overlap = (a: number, b: number, c: number, d: number) => a < d && c < b;
export function duration(record: RecordData, params: PlanParams, ctx: Context) {
  const rule = ctx.rules[record.building];
  return rule?.jobPlanPrecedence && record.duration
    ? record.duration
    : (params.durationOverride ?? rule?.minutes ?? record.duration);
}
function fitsLabor(item: ScheduleItem, record: RecordData, ctx: Context) {
  const l = ctx.labor.find((l) => l.id === item.laborId);
  return (
    !!l &&
    l.siteIds.includes(record.siteId) &&
    l.skills.includes(record.skill) &&
    l.shifts.includes(item.shift) &&
    !l.unavailableDates.includes(riyadhDay(item.start))
  );
}
export function validatePlan(
  items: ScheduleItem[],
  params: PlanParams,
  ctx: Context,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, string>(),
    dayGroups = new Map<string, string>();
  for (const item of items) {
    const key = recordKey(item.identity),
      r = ctx.records.find((r) => recordKey(r) === key);
    if (seen.has(key)) errors.push(`${key}: duplicate assignment`);
    seen.add(key);
    if (!r) {
      errors.push(`${key}: missing authoritative record`);
      continue;
    }
    if (
      r.type !== "WO" ||
      ["CLOSE", "COMP", "CAN"].includes(r.status) ||
      (params.pmLinkedOnly && !r.pmId) ||
      (params.project && r.project !== params.project) ||
      (params.building && r.building !== params.building) ||
      (params.recordIds && !params.recordIds.some((i) => recordKey(i) === key))
    )
      errors.push(`${key}: record outside requested scope`);
    if (item.color !== r.color || item.building !== r.building)
      errors.push(`${key}: unconfirmed scheduling metadata`);
    const start = Date.parse(item.start),
      end = Date.parse(item.finish),
      day = riyadhDay(item.start),
      shift = ctx.shifts.find((s) => s.id === item.shift);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      (end - start) / 60000 !== duration(r, params, ctx) ||
      item.minutes !== (end - start) / 60000
    )
      errors.push(`${key}: duration violation`);
    if (
      (r.earliestStart && start < Date.parse(r.earliestStart)) ||
      (r.latestFinish && end > Date.parse(r.latestFinish))
    )
      errors.push(`${key}: hard record window violation`);
    if (!r.materialsReady || ctx.restrictedBuildings.includes(r.building))
      errors.push(`${key}: material or site restriction`);
    if (!fitsLabor(item, r, ctx))
      errors.push(`${key}: labor availability or skills violation`);
    if (
      day < params.startDate ||
      day >= addDays(params.startDate, params.days) ||
      ctx.holidays.includes(day)
    )
      errors.push(`${key}: calendar violation`);
    if (!shift) errors.push(`${key}: shift missing`);
    else {
      const shiftStart = Date.parse(
        `${day}T${String(shift.startHour).padStart(2, "0")}:00:00+03:00`,
      );
      if (start < shiftStart || end > shiftStart + shift.hours * 3600000)
        errors.push(`${key}: shift boundary violation`);
    }
    const requestedStart = Date.parse(
      `${params.startDate}T${params.startTime}:00+03:00`,
    );
    if (start < requestedStart)
      errors.push(`${key}: requested start violation`);
    const windows =
      ctx.availability?.filter((w) => w.laborId === item.laborId) ?? [];
    if (
      windows.length &&
      !windows.some(
        (w) => start >= Date.parse(w.start) && end <= Date.parse(w.finish),
      )
    )
      errors.push(`${key}: outside explicit availability`);
    if (params.colorSeparation) {
      if (!r.color) errors.push(`${key}: color mapping unconfirmed`);
      else {
        if (groups.has(r.color) && groups.get(r.color) !== day)
          errors.push(`${key}: color split across days`);
        if (dayGroups.has(day) && dayGroups.get(day) !== r.color)
          errors.push(`${key}: different colors on same day`);
        groups.set(r.color, day);
        dayGroups.set(day, r.color);
      }
    }
    const existing = ctx.records.filter(
      (e) =>
        e.type === "WO" &&
        e.scheduledStart &&
        e.scheduledFinish &&
        e.laborId === item.laborId &&
        recordKey(e) !== key &&
        !items.some((i) => recordKey(i.identity) === recordKey(e)),
    );
    if (
      existing.some((e) =>
        overlap(
          start,
          end,
          Date.parse(e.scheduledStart!),
          Date.parse(e.scheduledFinish!),
        ),
      )
    )
      errors.push(`${key}: existing assignment conflict`);
  }
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (
        items[i].laborId === items[j].laborId &&
        overlap(
          Date.parse(items[i].start),
          Date.parse(items[i].finish),
          Date.parse(items[j].start),
          Date.parse(items[j].finish),
        )
      )
        errors.push("Labor resource overlap");
  return [...new Set(errors)];
}
export function createPlan(input: PlanParams, ctx: Context): Plan {
  const params = PlanParams.parse(input),
    id = randomUUID();
  const candidates = ctx.records
    .filter(
      (r) =>
        r.type === "WO" &&
        !["COMP", "CLOSE", "CAN"].includes(r.status) &&
        (!params.pmLinkedOnly || !!r.pmId) &&
        (!params.project || r.project === params.project) &&
        (!params.building || r.building === params.building) &&
        (!r.scheduledStart || params.includeScheduled) &&
        (!params.recordIds ||
          params.recordIds.some((i) => recordKey(i) === recordKey(r))),
    )
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        Date.parse(a.targetFinish ?? a.due) -
          Date.parse(b.targetFinish ?? b.due) ||
        a.id.localeCompare(b.id),
    );
  const colors = [
    ...new Set(candidates.map((r) => r.color).filter((c): c is string => !!c)),
  ].sort();
  const items: ScheduleItem[] = [],
    unscheduled: Plan["unscheduled"] = [];
  for (const r of candidates) {
    const minutes = duration(r, params, ctx);
    let reason = !r.materialsReady
      ? "Required materials are unavailable"
      : ctx.restrictedBuildings.includes(r.building)
        ? "Building has an active site restriction"
        : !minutes
          ? "No confirmed duration rule or job plan"
          : params.colorSeparation && !r.color
            ? "Color group is unknown; confirm the mapping"
            : null;
    if (reason) {
      unscheduled.push({ identity: r, reason });
      continue;
    }
    let assigned = false;
    for (let d = 0; d < params.days && !assigned; d++) {
      if (params.colorSeparation && d !== colors.indexOf(r.color!)) continue;
      const day = addDays(params.startDate, d);
      if (ctx.holidays.includes(day)) continue;
      for (const shift of [...ctx.shifts].sort(
        (a, b) => a.startHour - b.startHour,
      )) {
        if (assigned) break;
        const shiftStart = Date.parse(
          `${day}T${String(shift.startHour).padStart(2, "0")}:00:00+03:00`,
        );
        const requested = Date.parse(
          `${params.startDate}T${params.startTime}:00+03:00`,
        );
        for (
          let at = Math.max(
            shiftStart,
            requested,
            r.earliestStart ? Date.parse(r.earliestStart) : 0,
          );
          at + minutes! * 60000 <=
            Math.min(
              shiftStart + shift.hours * 3600000,
              r.latestFinish ? Date.parse(r.latestFinish) : Infinity,
            ) && !assigned;
          at += 5 * 60000
        ) {
          for (const l of ctx.labor) {
            if (
              !l.siteIds.includes(r.siteId) ||
              !l.skills.includes(r.skill) ||
              !l.shifts.includes(shift.id) ||
              l.unavailableDates.includes(day)
            )
              continue;
            const windows =
              ctx.availability?.filter((w) => w.laborId === l.id) ?? [];
            if (
              windows.length &&
              !windows.some(
                (w) =>
                  at >= Date.parse(w.start) &&
                  at + minutes! * 60000 <= Date.parse(w.finish),
              )
            )
              continue;
            const item: ScheduleItem = {
              identity: { type: "WO", id: r.id, siteId: r.siteId },
              description: r.description,
              start: new Date(at).toISOString(),
              finish: new Date(at + minutes! * 60000).toISOString(),
              laborId: l.id,
              minutes: minutes!,
              color: r.color,
              building: r.building,
              due: r.due,
              priority: r.priority,
              shift: shift.id,
            };
            if (
              !items.some(
                (existing) =>
                  existing.laborId === item.laborId &&
                  overlap(
                    Date.parse(existing.start),
                    Date.parse(existing.finish),
                    at,
                    at + minutes! * 60000,
                  ),
              ) &&
              !validatePlan([item], params, ctx).length
            ) {
              items.push(item);
              assigned = true;
              break;
            }
          }
        }
      }
    }
    if (!assigned) {
      reason = ctx.labor.some(
        (l) => l.siteIds.includes(r.siteId) && l.skills.includes(r.skill),
      )
        ? "No feasible capacity within shifts, color-day allocation and horizon; extend the horizon or change confirmed availability"
        : "No available labor with required skill and site authorization";
      unscheduled.push({
        identity: { type: r.type, id: r.id, siteId: r.siteId },
        reason,
      });
    }
  }
  const conflicts = validatePlan(items, params, ctx);
  if (conflicts.length)
    throw new AppError(500, "Scheduler produced an invalid plan");
  const workload: Record<string, number> = {};
  const changes: Change[] = items.map((item) => {
    const r = ctx.records.find(
      (r) => recordKey(r) === recordKey(item.identity),
    )!;
    workload[item.laborId] = (workload[item.laborId] ?? 0) + item.minutes;
    return {
      key: recordKey(r),
      identity: item.identity,
      description: r.description,
      revision: r.revision,
      before: pickValues(r, ["scheduledStart", "scheduledFinish", "laborId"]),
      after: {
        scheduledStart: item.start,
        scheduledFinish: item.finish,
        laborId: item.laborId,
      },
      reason: `${item.minutes} min; ${r.duration && ctx.rules[r.building]?.jobPlanPrecedence ? "approved job-plan duration" : "editable planning estimate"}; priority ${r.priority}; shift ${item.shift}`,
      conflicts: [],
      pmImpact:
        "WO schedule only. PM frequency, next due date and generation settings remain unchanged.",
    };
  });
  return {
    id,
    parameters: params,
    items,
    unscheduled,
    conflicts,
    explanations: [
      "Deterministic priority/due-date greedy fallback; every assignment independently validated.",
      params.colorSeparation
        ? "Each confirmed color occupies a separate Riyadh calendar day. Unknown colors require review."
        : "Color separation is inactive.",
      "Priority 1 is highest. Existing assignments reserve technician time.",
      `${
        items.filter((i) => {
          const r = ctx.records.find(
            (r) => recordKey(r) === recordKey(i.identity),
          )!;
          return Date.parse(i.finish) > Date.parse(r.targetFinish ?? r.due);
        }).length
      } tasks finish after their target/due date (soft constraint).`,
    ],
    workload,
    changes,
    solver: "deterministic-fallback",
  };
}

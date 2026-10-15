import { fixtures, labor } from "../../packages/shared/seed.ts";
import type { Context } from "../../packages/scheduler/index.ts";
import type { PlanParams } from "../../packages/domain/index.ts";
export const params: PlanParams = {
  project: "1611",
  startDate: "2026-10-19",
  days: 7,
  startTime: "08:00",
  colorSeparation: true,
  includeScheduled: false,
};
export function context(): Context {
  return {
    records: fixtures(),
    labor: structuredClone(labor),
    rules: {
      MATAF: { minutes: 15, jobPlanPrecedence: true },
      SHAMIYA: { minutes: 30, jobPlanPrecedence: true },
      GB: { minutes: 60, jobPlanPrecedence: true },
      PZ: { minutes: 30, jobPlanPrecedence: true },
      SVB: { minutes: 30, jobPlanPrecedence: true },
      NBB: { minutes: 30, jobPlanPrecedence: true },
    },
    shifts: [
      { id: 1, startHour: 8, hours: 8 },
      { id: 2, startHour: 16, hours: 8 },
      { id: 3, startHour: 0, hours: 8 },
    ],
    holidays: [],
    restrictedBuildings: [],
  };
}

import { config } from "../shared/config.ts";
import { createPlan, validatePlan, type Context } from "./index.ts";
import {
  AppError,
  pickValues,
  recordKey,
  type PlanParams,
  type ScheduleItem,
  type Plan,
} from "../domain/index.ts";
export async function optimizedPlan(
  params: PlanParams,
  ctx: Context,
): Promise<Plan> {
  const fallback = createPlan(params, ctx);
  try {
    const r = await fetch(config.OPTIMIZER_URL!.replace(/\/$/, "") + "/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parameters: fallback.parameters, context: ctx }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`Optimizer HTTP ${r.status}`);
    const result = (await r.json()) as {
      items: ScheduleItem[];
      unscheduled: Plan["unscheduled"];
      status: string;
    };
    const conflicts = validatePlan(result.items, fallback.parameters, ctx);
    if (conflicts.length)
      throw new AppError(
        502,
        "Optimizer returned invalid schedule: " + conflicts.join("; "),
      );
    const workload: Record<string, number> = {};
    const changes = result.items.map((i) => {
      const r = ctx.records.find(
        (r) => recordKey(r) === recordKey(i.identity),
      )!;
      workload[i.laborId] = (workload[i.laborId] ?? 0) + i.minutes;
      return {
        key: recordKey(r),
        identity: i.identity,
        description: r.description,
        revision: r.revision,
        before: pickValues(r, ["scheduledStart", "scheduledFinish", "laborId"]),
        after: {
          scheduledStart: i.start,
          scheduledFinish: i.finish,
          laborId: i.laborId,
        },
        reason: `CP-SAT ${result.status}; ${i.minutes} minutes; priority ${r.priority}; shift ${i.shift}`,
        conflicts: [],
        pmImpact: "WO scheduling only; PM generation settings unchanged.",
      };
    });
    return {
      ...fallback,
      items: result.items,
      unscheduled: result.unscheduled,
      changes,
      workload,
      solver: "OR-Tools CP-SAT (" + result.status + ")",
      explanations: [
        "CP-SAT prioritizes due dates and priority, avoids resource conflicts and balances workload.",
        "Every result passed independent Node constraint validation.",
      ],
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    fallback.explanations.push(
      "Optimization service unavailable; deterministic fallback used.",
    );
    return fallback;
  }
}

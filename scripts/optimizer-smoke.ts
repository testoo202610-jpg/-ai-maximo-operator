import assert from "node:assert/strict";
import { optimizedPlan } from "../packages/scheduler/optimizer.ts";
import { validatePlan } from "../packages/scheduler/index.ts";
import { context, params } from "../tests/fixtures/context.ts";
const ctx = context();
ctx.records.push({
  ...ctx.records.find((r) => r.type === "WO" && r.project === "1611")!,
  id: "WO-CORRECTIVE",
  pmId: null,
});
const plan = await optimizedPlan({ ...params, pmLinkedOnly: true }, ctx);
assert.ok(!plan.items.some((i) => i.identity.id === "WO-CORRECTIVE"));
assert.match(plan.solver, /OR-Tools CP-SAT/);
assert.ok(plan.items.length > 3);
assert.deepEqual(validatePlan(plan.items, plan.parameters, ctx), []);
console.log(
  JSON.stringify({
    solver: plan.solver,
    scheduled: plan.items.length,
    unscheduled: plan.unscheduled.length,
    validated: true,
  }),
);

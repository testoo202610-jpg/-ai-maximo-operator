import { db } from "../../packages/shared/db.ts";
import { seed } from "../../packages/shared/seed.ts";
import { executeJob } from "./engine.ts";
seed();
let stop = false;
let currentJob: string | null = null;
function requestStop() {
  stop = true;
  if (currentJob)
    db.prepare("UPDATE execution_jobs SET stop_requested=1 WHERE id=?").run(
      currentJob,
    );
}
process.on("SIGTERM", () => {
  requestStop();
});
process.on("SIGINT", () => {
  requestStop();
});
console.log("Operator runner: persistent approved jobs only.");
while (!stop) {
  const job = db
    .prepare(
      "SELECT id FROM execution_jobs WHERE status IN ('QUEUED','RUNNING') AND (lease_until IS NULL OR lease_until<?) ORDER BY created_at LIMIT 1",
    )
    .get(new Date().toISOString());
  if (job) {
    currentJob = String(job.id);
    await executeJob(currentJob);
    currentJob = null;
  }
  await new Promise((r) => setTimeout(r, job ? 250 : 1000));
}

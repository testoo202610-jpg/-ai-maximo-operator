import { spawn, type ChildProcess } from "node:child_process";
import { seed } from "../packages/shared/seed.ts";
import { config } from "../packages/shared/config.ts";
seed();
if (config.MAXIMO_MODE === "simulation") {
  const { seedSimulator } = await import("../apps/simulator/store.ts");
  seedSimulator();
}
const children: ChildProcess[] = [];
function run(args: string[]) {
  const c = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.push(c);
  c.on("exit", (code) => {
    if (code && !stopping) {
      console.error("A service exited with code", code);
      shutdown(code);
    }
  });
}
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
if (config.MAXIMO_MODE === "simulation")
  run(["--import", "tsx", "apps/simulator/server.ts"]);
run(["--import", "tsx", "apps/api/server.ts"]);
run(["--import", "tsx", "apps/operator-runner/main.ts"]);
if (process.env.NODE_ENV !== "production")
  run(["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"]);

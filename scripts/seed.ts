import { seed } from "../packages/shared/seed.ts";
import { config } from "../packages/shared/config.ts";
seed();
if (config.MAXIMO_MODE === "simulation") {
  const { seedSimulator } = await import("../apps/simulator/store.ts");
  seedSimulator();
  console.log("Repeatable fictitious simulation seed applied.");
} else
  console.log(
    "Live-mode application defaults initialized. No maintenance records or labor resources were invented.",
  );

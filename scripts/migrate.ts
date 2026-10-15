import { migrate } from "../packages/shared/db.ts";
migrate();
console.log("Database migrations applied.");

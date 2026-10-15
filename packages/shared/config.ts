import "dotenv/config";
import { z } from "zod";
const Bool = z.enum(["true", "false"]).transform((x) => x === "true");
const schema = z.object({
  MAXIMO_MODE: z
    .enum(["simulation", "live-readonly", "live-approved"])
    .default("simulation"),
  MAXIMO_CONNECTOR_MODE: z.enum(["browser", "rest"]).default("browser"),
  MAXIMO_READ_ONLY: Bool.default(false),
  MAXIMO_PRODUCTION_WRITE_ENABLED: Bool.default(false),
  MAXIMO_BASE_URL: z.string().url().optional(),
  MAXIMO_AUTH_MODE: z.enum(["apikey", "bearer", "session"]).default("apikey"),
  MAXIMO_API_KEY: z.string().optional(),
  MAXIMO_SITE_IDS: z.string().default(""),
  MAXIMO_MAPPING_FILE: z.string().optional(),
  MAXIMO_BROWSER_STATE: z.string().optional(),
  DATABASE_URL: z.string().default("data/operator.sqlite"),
  SIMULATOR_DATABASE_URL: z.string().default("data/simulator.sqlite"),
  SIMULATOR_BASE_URL: z.string().url().default("http://127.0.0.1:3002"),
  PORT: z.coerce.number().default(3001),
  SIMULATOR_PORT: z.coerce.number().default(3002),
  HOST: z.string().default("127.0.0.1"),
  AI_PROVIDER: z
    .enum(["deterministic", "openai-compatible"])
    .default("deterministic"),
  AI_MODEL: z.string().default(""),
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_EXTERNAL_DATA_ALLOWED: Bool.default(false),
  OPTIMIZER_URL: z.string().url().optional(),
  OPERATOR_PASSWORD: z.string().optional(),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  BROWSER_EXECUTABLE: z.string().optional(),
});
export const config = schema.parse(process.env);
if (
  config.MAXIMO_MODE !== "simulation" &&
  (!config.OPERATOR_PASSWORD || config.OPERATOR_PASSWORD.length < 16)
)
  throw new Error(
    "Live mode requires OPERATOR_PASSWORD of at least 16 characters",
  );
export function productionPolicy() {
  return (
    config.MAXIMO_MODE === "live-approved" &&
    !config.MAXIMO_READ_ONLY &&
    config.MAXIMO_PRODUCTION_WRITE_ENABLED
  );
}

if (config.MAXIMO_MODE !== "simulation" && config.MAXIMO_BASE_URL) {
  const u = new URL(config.MAXIMO_BASE_URL);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new Error("Live Maximo requires HTTPS without embedded credentials");
}

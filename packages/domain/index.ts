import { z } from "zod";
export const RecordType = z.enum(["WO", "PM"]);
export const Identity = z.object({
  type: RecordType,
  id: z.string().regex(/^[\w-]{1,60}$/),
  siteId: z.string().regex(/^[\w-]{1,40}$/),
});
export type Identity = z.infer<typeof Identity>;
export const ScheduleValues = z
  .object({
    scheduledStart: z.iso.datetime({ offset: true }).nullable().optional(),
    scheduledFinish: z.iso.datetime({ offset: true }).nullable().optional(),
    laborId: z.string().max(60).nullable().optional(),
    nextDue: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export type ScheduleValues = z.infer<typeof ScheduleValues>;
export type RecordData = Identity & {
  description: string;
  project: string;
  building: string;
  location: string;
  asset: string;
  status: string;
  revision: string;
  priority: number;
  duration: number | null;
  skill: string;
  color: string | null;
  materialsReady: boolean;
  due: string;
  targetStart?: string | null;
  targetFinish?: string | null;
  earliestStart?: string | null;
  latestFinish?: string | null;
  scheduledStart: string | null;
  scheduledFinish: string | null;
  laborId: string | null;
  nextDue: string | null;
  pmId: string | null;
  frequency?: string;
  pmBehaviorVerified?: boolean;
  hierarchy?: string;
  forecast?: string;
  extendedDate?: string | null;
};
export const RecordSchema = Identity.extend({
  description: z.string(),
  project: z.string(),
  building: z.string(),
  location: z.string(),
  asset: z.string(),
  status: z.string(),
  revision: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  duration: z.number().positive().nullable(),
  skill: z.string().min(1),
  color: z.string().nullable(),
  materialsReady: z.boolean(),
  due: z.iso.datetime({ offset: true }),
  targetStart: z.iso.datetime({ offset: true }).nullable().optional(),
  targetFinish: z.iso.datetime({ offset: true }).nullable().optional(),
  earliestStart: z.iso.datetime({ offset: true }).nullable().optional(),
  latestFinish: z.iso.datetime({ offset: true }).nullable().optional(),
  scheduledStart: z.iso.datetime({ offset: true }).nullable(),
  scheduledFinish: z.iso.datetime({ offset: true }).nullable(),
  laborId: z.string().nullable(),
  nextDue: z.iso.datetime({ offset: true }).nullable(),
  pmId: z.string().nullable(),
  frequency: z.string().optional(),
  pmBehaviorVerified: z.boolean().optional(),
  hierarchy: z.string().optional(),
  forecast: z.string().optional(),
  extendedDate: z.string().nullable().optional(),
});
export const LaborSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  skills: z.array(z.string()),
  siteIds: z.array(z.string()),
  shifts: z.array(z.number().int()),
  unavailableDates: z.array(z.iso.date()),
});
export type Labor = {
  id: string;
  name: string;
  skills: string[];
  siteIds: string[];
  shifts: number[];
  unavailableDates: string[];
};
export const PlanParams = z
  .object({
    project: z.enum(["1610", "1611", "1612", "1613"]).optional(),
    building: z.string().max(80).optional(),
    startDate: z.iso.date(),
    days: z.number().int().min(1).max(31).default(7),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("08:00"),
    colorSeparation: z.boolean().default(false),
    durationOverride: z.number().int().min(5).max(480).optional(),
    includeScheduled: z.boolean().default(false),
    pmLinkedOnly: z.boolean().optional(),
    recordIds: z.array(Identity).max(500).optional(),
  })
  .strict();
export type PlanParams = z.infer<typeof PlanParams>;
export type Change = {
  key: string;
  identity: Identity;
  description: string;
  revision: string;
  before: ScheduleValues;
  after: ScheduleValues;
  reason: string;
  conflicts: string[];
  pmImpact: string;
};
export type ScheduleItem = {
  identity: Identity;
  description: string;
  start: string;
  finish: string;
  laborId: string;
  minutes: number;
  color: string | null;
  building: string;
  due: string;
  priority: number;
  shift: number;
};
export type Plan = {
  id: string;
  parameters: PlanParams;
  items: ScheduleItem[];
  unscheduled: { identity: Identity; reason: string }[];
  conflicts: string[];
  explanations: string[];
  workload: Record<string, number>;
  changes: Change[];
  solver: string;
};
export type Capabilities = {
  mode: string;
  connector: string;
  authenticated: boolean;
  read: boolean;
  write: boolean;
  pmWrite: boolean;
  conditional: boolean;
  fields: string[];
  limitations: string[];
  resources: Record<string, string>;
};
export interface MaximoConnector {
  capabilities(): Promise<Capabilities>;
  search(
    type: "WO" | "PM",
    filters?: Record<string, string>,
  ): Promise<RecordData[]>;
  read(identity: Identity): Promise<RecordData>;
  update(
    identity: Identity,
    values: ScheduleValues,
    revision: string,
  ): Promise<void>;
  labor(): Promise<Labor[]>;
  close?(): Promise<void>;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "VALIDATION",
  ) {
    super(message);
  }
}
export const recordKey = (i: Identity) => `${i.type}:${i.siteId}:${i.id}`;
export function pickValues(
  record: RecordData,
  fields: string[],
): ScheduleValues {
  return Object.fromEntries(
    fields.map((f) => [f, record[f as keyof RecordData]]),
  ) as ScheduleValues;
}
export function exactValues(a: ScheduleValues, b: ScheduleValues): boolean {
  return Object.keys(b).every(
    (k) => a[k as keyof ScheduleValues] === b[k as keyof ScheduleValues],
  );
}
export function validateWrite(
  identity: Identity,
  values: ScheduleValues,
  record: RecordData,
) {
  Identity.parse(identity);
  ScheduleValues.parse(values);
  if (recordKey(identity) !== recordKey(record))
    throw new AppError(409, "Record identity or site mismatch", "IDENTITY");
  const keys = Object.keys(values),
    allowed =
      identity.type === "WO"
        ? ["scheduledStart", "scheduledFinish", "laborId"]
        : ["nextDue"];
  if (!keys.length || keys.some((k) => !allowed.includes(k)))
    throw new AppError(403, "Operation contains prohibited fields", "FIELDS");
  if (identity.type === "PM" && !record.pmBehaviorVerified)
    throw new AppError(
      403,
      "PM generation behavior is unknown; due-date modification blocked",
      "PM_BEHAVIOR",
    );
  if (["CLOSE", "COMP", "CAN", "INACTIVE"].includes(record.status))
    throw new AppError(
      409,
      "Record status does not permit scheduling",
      "STATUS",
    );
  if (identity.type === "WO") {
    const start = values.scheduledStart ?? record.scheduledStart,
      finish = values.scheduledFinish ?? record.scheduledFinish;
    if (!start || !finish || Date.parse(finish) <= Date.parse(start))
      throw new AppError(
        400,
        "WO start and finish must form a positive interval",
      );
  }
}

import { db, migrate } from "./db.ts";
import { config } from "./config.ts";
import { bindDataset } from "./dataset.ts";
import type { Labor, RecordData } from "../domain/index.ts";
export const labor: Labor[] = [
  {
    id: "L-01",
    name: "أحمد سالم",
    skills: ["mechanical", "inspection"],
    siteIds: ["HARAM"],
    shifts: [1, 2],
    unavailableDates: [],
  },
  {
    id: "L-02",
    name: "خالد علي",
    skills: ["electrical", "inspection"],
    siteIds: ["HARAM"],
    shifts: [1, 3],
    unavailableDates: [],
  },
  {
    id: "L-03",
    name: "Omar Hassan",
    skills: ["mechanical", "inspection"],
    siteIds: ["NORTH"],
    shifts: [1, 2, 3],
    unavailableDates: [],
  },
];
export function seed() {
  migrate();
  const simulation = config.MAXIMO_MODE === "simulation";
  bindDataset(
    db,
    simulation ? "simulation" : "live",
    simulation ? config.SIMULATOR_BASE_URL : config.MAXIMO_BASE_URL,
  );
  db.prepare(
    "INSERT OR IGNORE INTO roles VALUES ('supervisor','Supervisor'),('planner','Planner'),('viewer','Viewer')",
  ).run();
  for (const role of ["supervisor", "planner", "viewer"])
    for (const action of role === "supervisor"
      ? ["read", "plan", "approve", "execute", "settings"]
      : role === "planner"
        ? ["read", "plan"]
        : ["read"])
      db.prepare("INSERT OR IGNORE INTO permissions VALUES (?,?)").run(
        role,
        action,
      );
  for (const [id, name, role] of [
    ["supervisor", "Local Supervisor", "supervisor"],
    ["planner", "Local Planner", "planner"],
    ["viewer", "Local Viewer", "viewer"],
  ])
    db.prepare("INSERT OR IGNORE INTO users VALUES (?,?,?)").run(
      id,
      name,
      role,
    );
  for (const [id, name] of simulation
    ? [
        ["HARAM", "Haram maintenance (fictitious)"],
        ["NORTH", "North facilities (fictitious)"],
      ]
    : [["UNMAPPED", "Configure authorized SITEID before synchronization"]])
    db.prepare("INSERT OR IGNORE INTO sites VALUES (?,?)").run(id, name);
  for (const [id, name, site] of [
    ["1610", "SHAMIYA", "HARAM"],
    ["1611", "MATAF", "HARAM"],
    ["1612", "GB / Jabal Al Kaaba", "NORTH"],
    ["1613", "Support facilities", "NORTH"],
  ])
    db.prepare("INSERT OR IGNORE INTO projects VALUES (?,?,?)").run(
      id,
      name,
      simulation ? site : "UNMAPPED",
    );
  for (const [b, m] of [
    ["MATAF", 15],
    ["SHAMIYA", 30],
    ["GB", 60],
    ["PZ", 30],
    ["SVB", 30],
    ["NBB", 30],
  ] as const)
    db.prepare("INSERT OR IGNORE INTO schedule_rules VALUES (?,?,1)").run(b, m);
  for (const [id, name, h] of [
    [1, "Day", 8],
    [2, "Evening", 16],
    [3, "Night", 0],
  ] as const)
    db.prepare("INSERT OR IGNORE INTO shifts VALUES (?,?,?,8)").run(
      id,
      name,
      h,
    );
  for (const l of simulation ? labor : []) {
    db.prepare("INSERT OR IGNORE INTO labor_resources VALUES (?,?,?)").run(
      l.id,
      l.name,
      JSON.stringify(l),
    );
    for (const s of l.skills)
      db.prepare("INSERT OR IGNORE INTO labor_skills VALUES (?,?)").run(
        l.id,
        s,
      );
  }
  db.prepare("INSERT OR IGNORE INTO settings VALUES ('calendar',?)").run(
    JSON.stringify({ holidays: [], restrictedBuildings: [] }),
  );
}
export function fixtures(): RecordData[] {
  const result: RecordData[] = [];
  for (let n = 1; n <= 32; n++) {
    const p = ["1611", "1611", "1610", "1612", "1613"][n % 5],
      building =
        p === "1611"
          ? "MATAF"
          : p === "1610"
            ? "SHAMIYA"
            : p === "1612"
              ? "GB"
              : ["PZ", "SVB", "NBB"][n % 3],
      siteId = ["1610", "1611"].includes(p) ? "HARAM" : "NORTH";
    const base = {
      siteId,
      project: p,
      building,
      location: `${building}-${String(n).padStart(2, "0")}`,
      asset: `AHU-${100 + n}`,
      status: n === 30 ? "COMP" : "APPR",
      revision: "1",
      priority: (n % 5) + 1,
      duration: n === 5 ? 45 : null,
      skill: n % 3 === 0 ? "electrical" : "inspection",
      color: n % 7 === 0 ? null : ["blue", "green", "amber"][n % 3],
      materialsReady: n !== 11,
      due: `2026-10-${String(16 + (n % 7)).padStart(2, "0")}T08:00:00+03:00`,
      scheduledStart: null,
      scheduledFinish: null,
      laborId: null,
      nextDue: null,
    };
    const pmId = `PM-${1000 + n}`;
    result.push({
      ...base,
      type: "PM",
      id: pmId,
      description: `${building} — ${n % 2 ? "فحص وحدة التهوية" : "Inspect circulation pump"}`,
      status: "ACTIVE",
      pmId: null,
      nextDue: base.due,
      frequency: "Every 30 days",
      pmBehaviorVerified: true,
      hierarchy: "Independent",
      forecast: "Next generation uses extended date",
      extendedDate: null,
    });
    result.push({
      ...base,
      type: "WO",
      id: `WO-${2000 + n}`,
      description: `${building} — ${n % 2 ? "فحص وصيانة دورية" : "Preventive equipment inspection"}`,
      pmId,
    });
  }
  return result;
}

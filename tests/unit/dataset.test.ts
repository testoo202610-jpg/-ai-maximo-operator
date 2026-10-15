import { describe, it, expect } from "vitest";
import { openDb, migrate } from "../../packages/shared/db.ts";
import { bindDataset } from "../../packages/shared/dataset.ts";
function fresh() {
  const d = openDb(":memory:");
  migrate(d);
  return d;
}
describe("deployment data isolation", () => {
  it("prevents simulation data being presented or executed as live Maximo", () => {
    const d = fresh();
    try {
      bindDataset(d, "simulation", "http://127.0.0.1:3002");
      expect(() =>
        bindDataset(d, "live", "https://authorized.example"),
      ).toThrow("mode mismatch");
    } finally {
      d.close();
    }
  });
  it("prevents an enterprise database being opened as a simulator", () => {
    const d = fresh();
    try {
      bindDataset(d, "live", "https://authorized.example");
      expect(() =>
        bindDataset(d, "simulation", "http://127.0.0.1:3002"),
      ).toThrow("mode mismatch");
    } finally {
      d.close();
    }
  });
  it("binds records and approvals to one configured deployment", () => {
    const d = fresh();
    try {
      bindDataset(d, "live", "https://test.example");
      expect(() => bindDataset(d, "live", "https://prod.example")).toThrow(
        "connection mismatch",
      );
      expect(() =>
        bindDataset(d, "live", "https://test.example"),
      ).not.toThrow();
    } finally {
      d.close();
    }
  });
  it("refuses to treat unclassified cached records as live data", () => {
    const d = fresh();
    try {
      d.prepare("INSERT INTO labor_resources VALUES (?,?,?)").run(
        "invented",
        "Fictitious",
        "{}",
      );
      expect(() =>
        bindDataset(d, "live", "https://authorized.example"),
      ).toThrow("Unclassified");
    } finally {
      d.close();
    }
  });
});

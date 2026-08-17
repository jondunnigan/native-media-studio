import { describe, expect, it } from "vitest";
import { determineReconciliationPlan, expectedColumns } from "./reconciliation-policy.mjs";

describe("Pterodactyl migration reconciliation policy", () => {
  it("does not stamp a fresh database", () => {
    expect(determineReconciliationPlan({ usersColumns: [], mediaJobsColumns: [] })).toEqual([]);
  });

  it("stamps only the users baseline when that complete baseline exists", () => {
    expect(determineReconciliationPlan({ usersColumns: expectedColumns.users, mediaJobsColumns: [] })).toEqual(["0000_premium_sabra"]);
  });

  it("stamps both migrations only when both complete tables already exist", () => {
    expect(determineReconciliationPlan({ usersColumns: expectedColumns.users, mediaJobsColumns: expectedColumns.media_jobs })).toEqual(["0000_premium_sabra", "0001_young_hex"]);
  });

  it("refuses partial or unsafe schemas rather than marking them migrated", () => {
    expect(() => determineReconciliationPlan({ usersColumns: ["id", "openId"], mediaJobsColumns: [] })).toThrow("Missing columns");
    expect(() => determineReconciliationPlan({ usersColumns: [], mediaJobsColumns: expectedColumns.media_jobs })).toThrow("users is missing");
  });
});

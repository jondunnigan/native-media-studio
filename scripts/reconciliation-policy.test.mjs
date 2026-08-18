import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { determineLegacyMediaJobsUpgrade, determineReconciliationPlan, expectedColumns, requiredLegacyMediaJobsColumns } from "./reconciliation-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

  it("ships a tracked utf8mb4 upgrade for emoji-bearing media titles", () => {
    const migration = readFileSync(path.join(projectRoot, "drizzle", "0002_media_jobs_utf8mb4.sql"), "utf8");
    expect(migration).toContain("ALTER TABLE `media_jobs` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin");
  });

  it("plans safe additive upgrades for historical media_jobs tables", () => {
    const additions = determineLegacyMediaJobsUpgrade(requiredLegacyMediaJobsColumns);
    expect(additions).toEqual(expect.arrayContaining([
      { column: "thumbnailUrl", definition: "text" },
      { column: "failureMessage", definition: "varchar(512)" },
    ]));
  });

  it("refuses an incomplete historical media_jobs core schema before serving conversions", () => {
    expect(() => determineLegacyMediaJobsUpgrade(["id", "ownerSessionId"])).toThrow("missing core columns");
  });
});

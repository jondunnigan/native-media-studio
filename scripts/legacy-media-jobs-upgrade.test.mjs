import { describe, expect, it } from "vitest";
import { requiredLegacyMediaJobsColumns } from "./reconciliation-policy.mjs";
import { upgradeLegacyMediaJobs } from "./legacy-media-jobs-upgrade.mjs";

describe("legacy media_jobs upgrade", () => {
  it("adds missing optional job columns and indexes before the application accepts conversions", async () => {
    const statements = [];
    const indexes = new Set();
    const connection = {
      execute: async statement => {
        statements.push(statement);
        if (statement.includes("media_jobs_session_created_idx")) indexes.add("media_jobs_session_created_idx");
        if (statement.includes("media_jobs_expiry_idx")) indexes.add("media_jobs_expiry_idx");
      },
    };

    const additions = await upgradeLegacyMediaJobs({
      connection,
      columns: new Set(requiredLegacyMediaJobsColumns),
      getIndexes: async () => indexes,
      tableName: "media_jobs_legacy_test",
    });

    expect(additions.map(item => item.column)).toEqual(expect.arrayContaining(["thumbnailUrl", "outputPath", "failureMessage"]));
    expect(statements).toEqual(expect.arrayContaining([
      "ALTER TABLE `media_jobs_legacy_test` ADD COLUMN `thumbnailUrl` text NULL",
      "CREATE INDEX `media_jobs_session_created_idx` ON `media_jobs_legacy_test` (`ownerSessionId`, `createdAt`)",
      "CREATE INDEX `media_jobs_expiry_idx` ON `media_jobs_legacy_test` (`expiresAt`)",
    ]));
  });
});

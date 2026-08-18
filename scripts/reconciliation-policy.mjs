export const expectedColumns = Object.freeze({
  users: Object.freeze([
    "id", "openId", "name", "email", "loginMethod", "role", "createdAt", "updatedAt", "lastSignedIn",
  ]),
  media_jobs: Object.freeze([
    "id", "ownerSessionId", "sourceUrl", "sourceId", "title", "thumbnailUrl", "durationSeconds", "mediaKind",
    "requestedQuality", "outputFormat", "status", "progress", "stage", "outputName", "outputPath", "outputMime",
    "outputBytes", "downloadTokenHash", "expiresAt", "downloadedAt", "failureMessage", "createdAt", "updatedAt",
  ]),
});

export const requiredLegacyMediaJobsColumns = Object.freeze([
  "id", "ownerSessionId", "sourceUrl", "sourceId", "title", "mediaKind", "requestedQuality", "outputFormat",
  "status", "progress", "stage", "createdAt", "updatedAt",
]);

export const additiveLegacyMediaJobsColumns = Object.freeze({
  thumbnailUrl: "text",
  durationSeconds: "int",
  outputName: "varchar(255)",
  outputPath: "varchar(512)",
  outputMime: "varchar(128)",
  outputBytes: "bigint",
  downloadTokenHash: "varchar(64)",
  expiresAt: "timestamp",
  downloadedAt: "timestamp",
  failureMessage: "varchar(512)",
});

export function missingExpectedColumns(tableName, columns) {
  const provided = columns instanceof Set ? columns : new Set(columns);
  return expectedColumns[tableName].filter(column => !provided.has(column));
}

export function determineLegacyMediaJobsUpgrade(columns) {
  const provided = columns instanceof Set ? columns : new Set(columns);
  const missingRequired = requiredLegacyMediaJobsColumns.filter(column => !provided.has(column));
  if (missingRequired.length) {
    throw new Error(`Existing table media_jobs is missing core columns: ${missingRequired.join(", ")}. Refusing an unsafe automatic upgrade.`);
  }
  return Object.entries(additiveLegacyMediaJobsColumns)
    .filter(([column]) => !provided.has(column))
    .map(([column, definition]) => ({ column, definition }));
}

export function determineReconciliationPlan({ usersColumns, mediaJobsColumns }) {
  const users = usersColumns instanceof Set ? usersColumns : new Set(usersColumns);
  const mediaJobs = mediaJobsColumns instanceof Set ? mediaJobsColumns : new Set(mediaJobsColumns);
  const hasUsers = users.size > 0;
  const hasMediaJobs = mediaJobs.size > 0;

  if (!hasUsers && !hasMediaJobs) return [];
  if (!hasUsers && hasMediaJobs) {
    throw new Error("media_jobs exists but users is missing. Refusing an unsafe automatic migration reconciliation.");
  }

  const missingUsers = missingExpectedColumns("users", users);
  if (missingUsers.length) {
    throw new Error(`Existing table users does not match the expected Native Media Studio schema. Missing columns: ${missingUsers.join(", ")}. Refusing to stamp migrations automatically.`);
  }

  if (!hasMediaJobs) return ["0000_premium_sabra"];

  const missingMediaJobs = missingExpectedColumns("media_jobs", mediaJobs);
  if (missingMediaJobs.length) {
    throw new Error(`Existing table media_jobs does not match the expected Native Media Studio schema. Missing columns: ${missingMediaJobs.join(", ")}. Refusing to stamp migrations automatically.`);
  }
  return ["0000_premium_sabra", "0001_young_hex"];
}

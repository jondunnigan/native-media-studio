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

export function missingExpectedColumns(tableName, columns) {
  const provided = columns instanceof Set ? columns : new Set(columns);
  return expectedColumns[tableName].filter(column => !provided.has(column));
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

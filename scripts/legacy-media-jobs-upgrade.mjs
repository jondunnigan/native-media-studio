import { determineLegacyMediaJobsUpgrade } from "./reconciliation-policy.mjs";

export async function upgradeLegacyMediaJobs({ connection, columns, getIndexes, log = () => undefined, tableName = "media_jobs" }) {
  if (columns.size === 0) return [];
  if (!/^[A-Za-z0-9_]+$/.test(tableName)) throw new Error("Unsafe media job table name.");
  const additions = determineLegacyMediaJobsUpgrade(columns);
  for (const { column, definition } of additions) {
    await connection.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${column}\` ${definition} NULL`);
    log(`[database] added legacy media_jobs column ${column}`);
  }

  const indexes = await getIndexes();
  if (!indexes.has("media_jobs_session_created_idx")) {
    await connection.execute(`CREATE INDEX \`media_jobs_session_created_idx\` ON \`${tableName}\` (\`ownerSessionId\`, \`createdAt\`)`);
    log("[database] added legacy media_jobs session index");
  }
  if (!indexes.has("media_jobs_expiry_idx")) {
    await connection.execute(`CREATE INDEX \`media_jobs_expiry_idx\` ON \`${tableName}\` (\`expiresAt\`)`);
    log("[database] added legacy media_jobs expiry index");
  }

  return additions;
}

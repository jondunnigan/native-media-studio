import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { upgradeLegacyMediaJobs } from "./legacy-media-jobs-upgrade.mjs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the legacy schema integration smoke test.");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const tableName = `media_jobs_legacy_smoke_${crypto.randomBytes(6).toString("hex")}`;

async function tableColumns() {
  const [rows] = await connection.execute(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName],
  );
  return new Set(rows.map(row => row.column_name));
}

async function tableIndexes() {
  const [rows] = await connection.execute(
    "SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName],
  );
  return new Set(rows.map(row => row.index_name));
}

try {
  await connection.execute(`CREATE TABLE \`${tableName}\` (
    \`id\` varchar(36) NOT NULL,
    \`ownerSessionId\` varchar(64) NOT NULL,
    \`sourceUrl\` text NOT NULL,
    \`sourceId\` varchar(64) NOT NULL,
    \`title\` varchar(255) NOT NULL,
    \`mediaKind\` enum('video','audio') NOT NULL,
    \`requestedQuality\` varchar(32) NOT NULL,
    \`outputFormat\` varchar(16) NOT NULL,
    \`status\` enum('queued','fetching','downloading','processing','ready','failed','expired','downloaded') NOT NULL DEFAULT 'queued',
    \`progress\` int NOT NULL DEFAULT 0,
    \`stage\` varchar(64) NOT NULL DEFAULT 'Queued',
    \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);

  const additions = await upgradeLegacyMediaJobs({
    connection,
    columns: await tableColumns(),
    getIndexes: tableIndexes,
    tableName,
  });
  const columns = await tableColumns();
  const indexes = await tableIndexes();
  if (!columns.has("outputPath") || !columns.has("failureMessage") || !indexes.has("media_jobs_session_created_idx") || !indexes.has("media_jobs_expiry_idx")) {
    throw new Error("Legacy media_jobs schema did not reconcile to the required optional columns and indexes.");
  }
  console.log(`[database] legacy media_jobs integration smoke test passed after adding ${additions.length} columns.`);
} finally {
  await connection.execute(`DROP TABLE IF EXISTS \`${tableName}\``).catch(() => undefined);
  await connection.end();
}

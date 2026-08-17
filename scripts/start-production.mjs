import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { determineReconciliationPlan } from "./reconciliation-policy.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = path.join(appRoot, "drizzle");
const retryAttempts = Math.max(1, Number.parseInt(process.env.MIGRATION_RETRY_ATTEMPTS ?? "10", 10) || 10);
const retryDelayMs = Math.max(250, Number.parseInt(process.env.MIGRATION_RETRY_DELAY_MS ?? "2000", 10) || 2000);

function loadMigrations() {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) throw new Error("Drizzle migration journal is missing from the image.");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  return journal.entries.map(entry => {
    const sql = readFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), "utf8");
    return {
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
    };
  });
}

async function tableColumns(connection, tableName) {
  const [rows] = await connection.execute(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName],
  );
  return new Set(rows.map(row => row.column_name));
}

async function ensureMigrationLedger(connection) {
  await connection.execute("CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (`id` serial PRIMARY KEY, `hash` text NOT NULL, `created_at` bigint)");
}

async function stampMigration(connection, migration) {
  const [rows] = await connection.execute("SELECT `id` FROM `__drizzle_migrations` WHERE `hash` = ? LIMIT 1", [migration.hash]);
  if (rows.length === 0) {
    await connection.execute("INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES (?, ?)", [migration.hash, migration.when]);
    console.log(`[database] reconciled existing schema with ${migration.tag}`);
  }
}

async function reconcileExistingSchema(connection) {
  const usersColumns = await tableColumns(connection, "users");
  const mediaColumns = await tableColumns(connection, "media_jobs");
  const migrationTags = determineReconciliationPlan({ usersColumns, mediaJobsColumns: mediaColumns });
  if (migrationTags.length === 0) return;
  await ensureMigrationLedger(connection);
  const migrations = loadMigrations();
  for (const tag of migrationTags) {
    const migration = migrations.find(item => item.tag === tag);
    if (!migration) throw new Error(`Expected migration ${tag} is missing from the image.`);
    await stampMigration(connection, migration);
  }
}

async function migrateDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required before the application can start.");
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection(process.env.DATABASE_URL);
      await reconcileExistingSchema(connection);
      await migrate(drizzle(connection), { migrationsFolder });
      await connection.end();
      console.log("[database] migrations are ready");
      return;
    } catch (error) {
      lastError = error;
      await connection?.end().catch(() => undefined);
      console.error(`[database] startup migration attempt ${attempt}/${retryAttempts} failed: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < retryAttempts) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

process.chdir(appRoot);
await migrateDatabase();
await import(path.join(appRoot, "dist", "index.js"));

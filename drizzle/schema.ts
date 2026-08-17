import { bigint, index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const mediaJobs = mysqlTable("media_jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerSessionId: varchar("ownerSessionId", { length: 64 }).notNull(),
  sourceUrl: text("sourceUrl").notNull(),
  sourceId: varchar("sourceId", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  thumbnailUrl: text("thumbnailUrl"),
  durationSeconds: int("durationSeconds"),
  mediaKind: mysqlEnum("mediaKind", ["video", "audio"]).notNull(),
  requestedQuality: varchar("requestedQuality", { length: 32 }).notNull(),
  outputFormat: varchar("outputFormat", { length: 16 }).notNull(),
  status: mysqlEnum("status", ["queued", "fetching", "downloading", "processing", "ready", "failed", "expired", "downloaded"]).default("queued").notNull(),
  progress: int("progress").default(0).notNull(),
  stage: varchar("stage", { length: 64 }).default("Queued").notNull(),
  outputName: varchar("outputName", { length: 255 }),
  outputPath: varchar("outputPath", { length: 512 }),
  outputMime: varchar("outputMime", { length: 128 }),
  outputBytes: bigint("outputBytes", { mode: "number" }),
  downloadTokenHash: varchar("downloadTokenHash", { length: 64 }),
  expiresAt: timestamp("expiresAt"),
  downloadedAt: timestamp("downloadedAt"),
  failureMessage: varchar("failureMessage", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("media_jobs_session_created_idx").on(table.ownerSessionId, table.createdAt),
  index("media_jobs_expiry_idx").on(table.expiresAt),
]);

export type MediaJob = typeof mediaJobs.$inferSelect;
export type InsertMediaJob = typeof mediaJobs.$inferInsert;

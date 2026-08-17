import { and, asc, desc, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertMediaJob, InsertUser, mediaJobs, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createMediaJob(job: InsertMediaJob) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(mediaJobs).values(job);
  return getMediaJob(job.id);
}

export async function getMediaJob(id: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const rows = await db.select().from(mediaJobs).where(eq(mediaJobs.id, id)).limit(1);
  return rows[0];
}

export async function updateMediaJob(id: string, values: Partial<InsertMediaJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(mediaJobs).set(values).where(eq(mediaJobs.id, id));
  return getMediaJob(id);
}

export async function listMediaJobsForSession(ownerSessionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(mediaJobs)
    .where(eq(mediaJobs.ownerSessionId, ownerSessionId))
    .orderBy(desc(mediaJobs.createdAt))
    .limit(20);
}

export async function listExpiredMediaJobs(now: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(mediaJobs)
    .where(and(lte(mediaJobs.expiresAt, now), eq(mediaJobs.status, "ready")))
    .orderBy(asc(mediaJobs.expiresAt));
}

export async function getReadyMediaJobByToken(id: string, tokenHash: string, now: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const rows = await db.select().from(mediaJobs).where(and(
    eq(mediaJobs.id, id),
    eq(mediaJobs.downloadTokenHash, tokenHash),
    eq(mediaJobs.status, "ready"),
  )).limit(1);
  const job = rows[0];
  if (!job || !job.expiresAt || job.expiresAt.getTime() <= now.getTime()) return undefined;
  return job;
}

import crypto from "node:crypto";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the media job insert smoke test.");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const id = `smoke-${crypto.randomUUID()}`.slice(0, 36);

try {
  await connection.beginTransaction();
  await connection.execute(
    "INSERT INTO `media_jobs` (`id`, `ownerSessionId`, `sourceUrl`, `sourceId`, `title`, `mediaKind`, `requestedQuality`, `outputFormat`, `status`, `progress`, `stage`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      "pterodactyl-schema-smoke",
      "https://www.youtube.com/watch?v=schema-smoke",
      "schema-smoke",
      "Emoji-safe media title 🎧",
      "video",
      "best",
      "mp4",
      "queued",
      0,
      "Queued",
    ],
  );
  await connection.rollback();
  console.log("[database] emoji-safe media_jobs insert smoke test passed and was rolled back.");
} catch (error) {
  await connection.rollback().catch(() => undefined);
  throw error;
} finally {
  await connection.end();
}

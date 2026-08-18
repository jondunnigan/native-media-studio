-- YouTube titles may include emoji and other supplementary Unicode characters.
-- Older MySQL/MariaDB defaults can use three-byte utf8 and reject those inserts.
-- Keep the binary collation used by Drizzle-compatible indexed identifiers.
ALTER TABLE `media_jobs` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `media_jobs` (
	`id` varchar(36) NOT NULL,
	`ownerSessionId` varchar(64) NOT NULL,
	`sourceUrl` text NOT NULL,
	`sourceId` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`thumbnailUrl` text,
	`durationSeconds` int,
	`mediaKind` enum('video','audio') NOT NULL,
	`requestedQuality` varchar(32) NOT NULL,
	`outputFormat` varchar(16) NOT NULL,
	`status` enum('queued','fetching','downloading','processing','ready','failed','expired','downloaded') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`stage` varchar(64) NOT NULL DEFAULT 'Queued',
	`outputName` varchar(255),
	`outputPath` varchar(512),
	`outputMime` varchar(128),
	`outputBytes` bigint,
	`downloadTokenHash` varchar(64),
	`expiresAt` timestamp,
	`downloadedAt` timestamp,
	`failureMessage` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `media_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `media_jobs_session_created_idx` ON `media_jobs` (`ownerSessionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `media_jobs_expiry_idx` ON `media_jobs` (`expiresAt`);
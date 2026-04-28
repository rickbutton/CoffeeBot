CREATE TABLE `characters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discord_id` text NOT NULL,
	`name` text NOT NULL,
	`realm` text NOT NULL,
	`region` text NOT NULL,
	`class_name` text NOT NULL,
	`spec` text,
	`level` integer,
	`race` text,
	`simc` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`discord_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `characters_owner_name_realm_uq` ON `characters` (`discord_id`,`region`,`realm`,`name`);--> statement-breakpoint
CREATE INDEX `characters_owner_idx` ON `characters` (`discord_id`);--> statement-breakpoint
CREATE TABLE `sim_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`character_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`simc_snapshot` text NOT NULL,
	`raidbots_report_id` text,
	`raidbots_url` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`wowaudit_uploaded_at` integer,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sim_jobs_status_idx` ON `sim_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `sim_jobs_character_idx` ON `sim_jobs` (`character_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`discord_id` text PRIMARY KEY NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);

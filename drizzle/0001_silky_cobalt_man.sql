PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_characters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`discord_id` text NOT NULL,
	`name` text NOT NULL,
	`realm` text NOT NULL,
	`region` text NOT NULL,
	`class_name` text NOT NULL,
	`spec` text,
	`level` integer,
	`race` text,
	`simc` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_requested_at` integer,
	FOREIGN KEY (`discord_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_characters`("id", "discord_id", "name", "realm", "region", "class_name", "spec", "level", "race", "simc", "updated_at", "last_requested_at") SELECT "id", "discord_id", "name", "realm", "region", "class_name", "spec", "level", "race", "simc", "updated_at", NULL FROM `characters`;--> statement-breakpoint
DROP TABLE `characters`;--> statement-breakpoint
ALTER TABLE `__new_characters` RENAME TO `characters`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `characters_owner_name_realm_spec_uq` ON `characters` (`discord_id`,`region`,`realm`,`name`,`spec`);--> statement-breakpoint
CREATE INDEX `characters_owner_idx` ON `characters` (`discord_id`);
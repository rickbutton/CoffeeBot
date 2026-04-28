ALTER TABLE `sim_jobs` RENAME COLUMN "raidbots_url" TO "report_url";--> statement-breakpoint
ALTER TABLE `sim_jobs` DROP COLUMN `raidbots_report_id`;
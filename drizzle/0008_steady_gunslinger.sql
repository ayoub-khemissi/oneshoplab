ALTER TABLE `products` ADD `status` enum('active','archived') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `last_seen_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `archived_at` timestamp;--> statement-breakpoint
-- Backfill: existing rows are treated as active and as last-seen at their
-- creation time. The next audit run will refresh last_seen_at and
-- re-evaluate presence; rows no longer in the scrape flip to 'archived'.
UPDATE `products` SET `last_seen_at` = `created_at` WHERE `last_seen_at` > `created_at`;--> statement-breakpoint
CREATE INDEX `idx_products_status` ON `products` (`status`);
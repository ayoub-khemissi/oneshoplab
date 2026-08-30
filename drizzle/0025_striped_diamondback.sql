CREATE TABLE `api_idempotency` (
	`key` varchar(64) NOT NULL,
	`body_hash` varchar(64) NOT NULL,
	`status` int NOT NULL,
	`response_json` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_idempotency_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `api_key_events` (
	`id` varchar(36) NOT NULL,
	`api_key_id` varchar(36) NOT NULL,
	`kind` enum('created','rotated','revoked','expired','auth_failed') NOT NULL,
	`ip` varchar(64),
	`at` timestamp NOT NULL DEFAULT (now()),
	`meta` json,
	CONSTRAINT `api_key_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`prefix` varchar(12) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`permissions` json NOT NULL,
	`expires_at` timestamp,
	`revoked_at` timestamp,
	`rotated_to_id` varchar(36),
	`grace_until` timestamp,
	`last_used_at` timestamp,
	`last_used_ip` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_api_keys_prefix` UNIQUE(`prefix`),
	CONSTRAINT `uniq_api_keys_key_hash` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE TABLE `catalog_sync_sessions` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`seen_source_ids` json NOT NULL,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`closed_at` timestamp,
	CONSTRAINT `catalog_sync_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_changes` (
	`id` varchar(26) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`product_id` varchar(36) NOT NULL,
	`product_source_id` varchar(255) NOT NULL,
	`field` enum('title','description','tags','images') NOT NULL,
	`value` json NOT NULL,
	`value_hash` varchar(64) NOT NULL,
	`prior_value_hash` varchar(64),
	`source_job_id` varchar(36),
	`status` enum('pending','applied','failed','skipped','conflict','cancelled','expired') NOT NULL DEFAULT 'pending',
	`approved_by` varchar(36) NOT NULL,
	`approved_at` timestamp NOT NULL DEFAULT (now()),
	`acked_at` timestamp,
	`ack_payload` json,
	`expires_at` timestamp,
	CONSTRAINT `product_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `api_key_events` ADD CONSTRAINT `api_key_events_api_key_id_api_keys_id_fk` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `catalog_sync_sessions` ADD CONSTRAINT `catalog_sync_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_changes` ADD CONSTRAINT `product_changes_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_changes` ADD CONSTRAINT `product_changes_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_changes` ADD CONSTRAINT `product_changes_source_job_id_jobs_id_fk` FOREIGN KEY (`source_job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `product_changes` ADD CONSTRAINT `product_changes_approved_by_users_id_fk` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_api_idempotency_created_at` ON `api_idempotency` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_api_key_events_key` ON `api_key_events` (`api_key_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_project_id` ON `api_keys` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_id` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_catalog_sync_sessions_project` ON `catalog_sync_sessions` (`project_id`,`closed_at`);--> statement-breakpoint
CREATE INDEX `idx_catalog_sync_sessions_expires` ON `catalog_sync_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_product_changes_project_status_id` ON `product_changes` (`project_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_product_changes_product` ON `product_changes` (`product_id`);
CREATE TABLE `wix_instances` (
	`instance_id` varchar(64) NOT NULL,
	`user_id` varchar(36),
	`project_id` varchar(36),
	`site_name` varchar(255),
	`site_host` varchar(255),
	`owner_email` varchar(255),
	`site_locale` varchar(16),
	`installed_at` timestamp NOT NULL DEFAULT (now()),
	`linked_at` timestamp,
	`uninstalled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `wix_instances_instance_id` PRIMARY KEY(`instance_id`)
);
--> statement-breakpoint
ALTER TABLE `subscriptions` MODIFY COLUMN `channel` enum('stripe','shopify','wix') NOT NULL DEFAULT 'stripe';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `billing_channel` enum('stripe','shopify','wix') NOT NULL DEFAULT 'stripe';--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `wix_instance_id` varchar(64);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `wix_purchase_key` varchar(191);--> statement-breakpoint
ALTER TABLE `wix_instances` ADD CONSTRAINT `wix_instances_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `wix_instances` ADD CONSTRAINT `wix_instances_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_wix_instances_user` ON `wix_instances` (`user_id`);
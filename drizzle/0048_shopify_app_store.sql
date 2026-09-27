CREATE TABLE `shopify_shops` (
	`shop_domain` varchar(255) NOT NULL,
	`user_id` varchar(36),
	`project_id` varchar(36),
	`pending_token_ciphertext` text,
	`scopes` json,
	`shop_name` varchar(255),
	`shop_email` varchar(255),
	`primary_domain` varchar(255),
	`partner_development` boolean NOT NULL DEFAULT false,
	`installed_at` timestamp NOT NULL DEFAULT (now()),
	`linked_at` timestamp,
	`uninstalled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shopify_shops_shop_domain` PRIMARY KEY(`shop_domain`)
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `channel` enum('stripe','shopify') DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `shopify_subscription_gid` varchar(128);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `shopify_shop_domain` varchar(255);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `next_credit_refill_at` timestamp;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `last_credit_refill_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `billing_channel` enum('stripe','shopify') DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE `shopify_shops` ADD CONSTRAINT `shopify_shops_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shopify_shops` ADD CONSTRAINT `shopify_shops_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_shopify_shops_user` ON `shopify_shops` (`user_id`);
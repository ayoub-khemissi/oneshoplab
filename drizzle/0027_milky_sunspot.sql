CREATE TABLE `shop_connections` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`platform` enum('shopify') NOT NULL DEFAULT 'shopify',
	`shop_domain` varchar(255) NOT NULL,
	`shop_name` varchar(255),
	`access_token_ciphertext` text NOT NULL,
	`key_id` varchar(16) NOT NULL DEFAULT 'v1',
	`scopes` json NOT NULL,
	`api_version` varchar(16) NOT NULL,
	`webhook_secret_ciphertext` text,
	`webhook_ids` json,
	`status` enum('connected','token_invalid','revoked') NOT NULL DEFAULT 'connected',
	`last_pull_at` timestamp,
	`pull_requested_at` timestamp,
	`pull_progress` json,
	`last_webhook_at` timestamp,
	`last_error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`revoked_at` timestamp,
	CONSTRAINT `shop_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_shop_connections_project` UNIQUE(`project_id`)
);
--> statement-breakpoint
ALTER TABLE `shop_connections` ADD CONSTRAINT `shop_connections_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_shop_connections_status` ON `shop_connections` (`status`);
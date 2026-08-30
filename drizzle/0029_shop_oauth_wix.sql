CREATE TABLE `gdpr_requests` (
	`id` varchar(36) NOT NULL,
	`shop_domain` varchar(255) NOT NULL,
	`topic` enum('customers/data_request','customers/redact','shop/redact') NOT NULL,
	`payload` json NOT NULL,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gdpr_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `shop_connections` MODIFY COLUMN `platform` enum('shopify','wix') NOT NULL DEFAULT 'shopify';--> statement-breakpoint
ALTER TABLE `shop_connections` ADD `auth_mode` enum('custom_app','oauth') DEFAULT 'custom_app' NOT NULL;--> statement-breakpoint
ALTER TABLE `shop_connections` ADD `installed_via_oauth_at` timestamp;--> statement-breakpoint
ALTER TABLE `shop_connections` ADD `instance_id` varchar(64);--> statement-breakpoint
ALTER TABLE `shop_connections` ADD `refresh_token_ciphertext` text;--> statement-breakpoint
CREATE INDEX `idx_gdpr_requests_shop` ON `gdpr_requests` (`shop_domain`);--> statement-breakpoint
CREATE INDEX `idx_shop_connections_shop_domain` ON `shop_connections` (`shop_domain`);--> statement-breakpoint
CREATE INDEX `idx_shop_connections_instance` ON `shop_connections` (`instance_id`);
CREATE TABLE `outbound_webhooks` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`kind` enum('self','manual') NOT NULL DEFAULT 'manual',
	`url` varchar(2048) NOT NULL,
	`url_hash` varchar(64) NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`key_id` varchar(16) NOT NULL DEFAULT 'v1',
	`events` json NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_delivery_at` timestamp,
	`last_status` int,
	`failure_streak` int NOT NULL DEFAULT 0,
	`failing_since` timestamp,
	`disabled_at` timestamp,
	CONSTRAINT `outbound_webhooks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_outbound_webhooks_project_url` UNIQUE(`project_id`,`url_hash`)
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` varchar(26) NOT NULL,
	`webhook_id` varchar(36) NOT NULL,
	`event_id` varchar(26) NOT NULL,
	`event` varchar(40) NOT NULL,
	`payload` json NOT NULL,
	`attempt` int NOT NULL DEFAULT 0,
	`status` enum('pending','delivered','failed','dead') NOT NULL DEFAULT 'pending',
	`response_status` int,
	`response_body` text,
	`next_attempt_at` timestamp,
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `kind` enum('chat_completed','chat_failed','image_completed','image_failed','audit_completed','audit_failed','bulk_completed','bulk_failed','integration_key_expiring','integration_key_expired','integration_key_revoked','integration_token_invalid','integration_sync_failed','integration_webhook_disabled') NOT NULL;--> statement-breakpoint
ALTER TABLE `outbound_webhooks` ADD CONSTRAINT `outbound_webhooks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outbound_webhooks` ADD CONSTRAINT `outbound_webhooks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhook_id_outbound_webhooks_id_fk` FOREIGN KEY (`webhook_id`) REFERENCES `outbound_webhooks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_outbound_webhooks_project` ON `outbound_webhooks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_due` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_webhook` ON `webhook_deliveries` (`webhook_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_created_at` ON `webhook_deliveries` (`created_at`);
CREATE TABLE `accounts` (
	`user_id` varchar(36) NOT NULL,
	`type` varchar(64) NOT NULL,
	`provider` varchar(64) NOT NULL,
	`provider_account_id` varchar(255) NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` int,
	`token_type` varchar(64),
	`scope` varchar(255),
	`id_token` text,
	`session_state` varchar(255),
	CONSTRAINT `accounts_provider_provider_account_id_pk` PRIMARY KEY(`provider`,`provider_account_id`)
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` varchar(36) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`anon_token` varchar(64),
	`project_id` varchar(36),
	`platform` enum('shopify','woocommerce','wix','manual','unknown') NOT NULL DEFAULT 'unknown',
	`status` enum('pending','running','completed','failed','timed_out') NOT NULL DEFAULT 'pending',
	`scores` json,
	`summary` json,
	`products_sampled` int,
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`started_at` timestamp,
	`completed_at` timestamp,
	CONSTRAINT `audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_transactions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`delta` int NOT NULL,
	`reason` varchar(64) NOT NULL,
	`job_id` varchar(36),
	`stripe_payment_id` varchar(128),
	`idempotency_key` varchar(128),
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `credit_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_credit_tx_idempotency` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36),
	`audit_id` varchar(36),
	`product_id` varchar(36),
	`kind` enum('audit_run','kie_alt_text','kie_description','kie_tags','kie_image_edit','kie_image_generate') NOT NULL,
	`status` enum('pending','running','completed','failed','timed_out') NOT NULL DEFAULT 'pending',
	`kie_task_id` varchar(128),
	`input_payload` json,
	`result` json,
	`error` text,
	`attempts` int NOT NULL DEFAULT 0,
	`credits_cost` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`started_at` timestamp,
	`finished_at` timestamp,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_jobs_kie_task_id` UNIQUE(`kie_task_id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`source` enum('shopify','woocommerce','wix','manual','unknown') NOT NULL,
	`source_id` varchar(255),
	`source_url` varchar(1024),
	`handle` varchar(255),
	`title` varchar(512) NOT NULL,
	`description_html` text,
	`images` json,
	`tags` json,
	`variants` json,
	`vendor` varchar(255),
	`product_type` varchar(255),
	`price_min` decimal(12,2),
	`price_max` decimal(12,2),
	`currency` varchar(8),
	`sku` varchar(128),
	`source_updated_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_products_project_source` UNIQUE(`project_id`,`source_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`source` enum('shopify','woocommerce','wix','manual','unknown') NOT NULL DEFAULT 'unknown',
	`url` varchar(1024),
	`domain` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_token` varchar(255) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires` timestamp NOT NULL,
	CONSTRAINT `sessions_session_token` PRIMARY KEY(`session_token`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`stripe_customer_id` varchar(128),
	`stripe_subscription_id` varchar(128),
	`plan` enum('free','starter','pro') NOT NULL DEFAULT 'free',
	`status` varchar(64) NOT NULL DEFAULT 'active',
	`current_period_end` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255),
	`email` varchar(255) NOT NULL,
	`email_verified` timestamp,
	`image` varchar(1024),
	`plan` enum('free','starter','pro') NOT NULL DEFAULT 'free',
	`credits_balance` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` varchar(255) NOT NULL,
	`token` varchar(255) NOT NULL,
	`expires` timestamp NOT NULL,
	CONSTRAINT `verification_tokens_identifier_token_pk` PRIMARY KEY(`identifier`,`token`)
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audits` ADD CONSTRAINT `audits_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_transactions` ADD CONSTRAINT `credit_transactions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_transactions` ADD CONSTRAINT `credit_transactions_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_audit_id_audits_id_fk` FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_audits_domain` ON `audits` (`domain`);--> statement-breakpoint
CREATE INDEX `idx_audits_anon_token` ON `audits` (`anon_token`);--> statement-breakpoint
CREATE INDEX `idx_audits_project_id` ON `audits` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_audits_status` ON `audits` (`status`);--> statement-breakpoint
CREATE INDEX `idx_credit_tx_user_id` ON `credit_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_project_id` ON `jobs` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_products_project_id` ON `products` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_user_id` ON `projects` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_domain` ON `projects` (`domain`);
CREATE TABLE `lead_attempts` (
	`id` varchar(36) NOT NULL,
	`lead_id` varchar(36) NOT NULL,
	`channel` enum('email','instagram','facebook','x','linkedin','manual') NOT NULL,
	`payload` text,
	`response` text,
	`attempted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lead_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` varchar(36) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`platform` enum('shopify','woocommerce','wix','manual','unknown') NOT NULL DEFAULT 'unknown',
	`products_sampled` int NOT NULL DEFAULT 0,
	`language` varchar(8),
	`country` varchar(4),
	`score` int,
	`contact_email` varchar(255),
	`contact_socials` json,
	`status` enum('new','contacted','replied','won','lost','dead') NOT NULL DEFAULT 'new',
	`notes` text,
	`discovered_via` text,
	`discovered_at` timestamp NOT NULL DEFAULT (now()),
	`qualified_at` timestamp,
	`last_attempted_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_leads_domain` UNIQUE(`domain`)
);
--> statement-breakpoint
ALTER TABLE `lead_attempts` ADD CONSTRAINT `lead_attempts_lead_id_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_lead_attempts_lead_id` ON `lead_attempts` (`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_lead_attempts_attempted_at` ON `lead_attempts` (`attempted_at`);--> statement-breakpoint
CREATE INDEX `idx_leads_status` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `idx_leads_platform` ON `leads` (`platform`);--> statement-breakpoint
CREATE INDEX `idx_leads_language` ON `leads` (`language`);--> statement-breakpoint
CREATE INDEX `idx_leads_discovered_at` ON `leads` (`discovered_at`);
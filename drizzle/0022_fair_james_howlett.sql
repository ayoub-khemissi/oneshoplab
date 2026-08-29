CREATE TABLE `contact_messages` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`name` varchar(120) NOT NULL,
	`email` varchar(255) NOT NULL,
	`subject` varchar(200),
	`message` text NOT NULL,
	`locale` varchar(8) NOT NULL DEFAULT 'en',
	`ip` varchar(64),
	`user_agent` varchar(255),
	`discord_notified_at` timestamp,
	`email_notified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `contact_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `contact_messages` ADD CONSTRAINT `contact_messages_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_contact_messages_created_at` ON `contact_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_contact_messages_email` ON `contact_messages` (`email`);--> statement-breakpoint
CREATE INDEX `idx_contact_messages_ip` ON `contact_messages` (`ip`);
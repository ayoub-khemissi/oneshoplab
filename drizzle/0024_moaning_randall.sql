CREATE TABLE `legal_consents` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`kind` varchar(40) NOT NULL,
	`version` varchar(32) NOT NULL,
	`source` varchar(128),
	`locale` varchar(8),
	`accepted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `legal_consents_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_legal_consents_source` UNIQUE(`kind`,`source`)
);
--> statement-breakpoint
ALTER TABLE `legal_consents` ADD CONSTRAINT `legal_consents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_legal_consents_user` ON `legal_consents` (`user_id`);
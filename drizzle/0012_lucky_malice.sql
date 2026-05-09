CREATE TABLE `share_links` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`product_source_ids` json NOT NULL,
	`label` varchar(120),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	CONSTRAINT `share_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_share_links_user_id` ON `share_links` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_share_links_project_id` ON `share_links` (`project_id`);
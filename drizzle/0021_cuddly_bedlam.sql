CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`kind` enum('chat_completed','chat_failed','image_completed','image_failed','audit_completed','audit_failed','bulk_completed','bulk_failed') NOT NULL,
	`job_id` varchar(36),
	`audit_id` varchar(36),
	`product_id` varchar(36),
	`project_id` varchar(36),
	`payload` json,
	`is_read` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_audit_id_audits_id_fk` FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_notif_user_unread_created` ON `notifications` (`user_id`,`is_read`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_notif_job_id` ON `notifications` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_notif_audit_id` ON `notifications` (`audit_id`);
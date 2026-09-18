CREATE TABLE `image_mirror_queue` (
	`id` varchar(36) NOT NULL,
	`project_id` varchar(36) NOT NULL,
	`product_id` varchar(36) NOT NULL,
	`source_url` varchar(2048) NOT NULL,
	`status` enum('pending','done','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_mirror_queue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `image_mirror_queue` ADD CONSTRAINT `image_mirror_queue_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `image_mirror_queue` ADD CONSTRAINT `image_mirror_queue_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_image_mirror_status_created` ON `image_mirror_queue` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_image_mirror_product` ON `image_mirror_queue` (`product_id`);
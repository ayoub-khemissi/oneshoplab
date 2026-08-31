CREATE TABLE `connection_capabilities` (
	`project_id` varchar(36) NOT NULL,
	`platform` varchar(32) NOT NULL,
	`capabilities` json NOT NULL,
	`reported_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connection_capabilities_project_id` PRIMARY KEY(`project_id`)
);
--> statement-breakpoint
ALTER TABLE `product_changes` ADD `prior_value` json;--> statement-breakpoint
ALTER TABLE `connection_capabilities` ADD CONSTRAINT `connection_capabilities_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;
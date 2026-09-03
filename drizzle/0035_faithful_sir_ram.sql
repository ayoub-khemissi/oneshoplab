ALTER TABLE `push_subscriptions` MODIFY COLUMN `endpoint` varchar(512);--> statement-breakpoint
ALTER TABLE `push_subscriptions` MODIFY COLUMN `p256dh` varchar(255);--> statement-breakpoint
ALTER TABLE `push_subscriptions` MODIFY COLUMN `auth` varchar(255);--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `channel` enum('webpush','fcm') DEFAULT 'webpush' NOT NULL;--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `device_token` varchar(512);--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `uq_push_subscriptions_device_token` UNIQUE(`device_token`);
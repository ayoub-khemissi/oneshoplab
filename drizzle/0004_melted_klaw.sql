ALTER TABLE `subscriptions` MODIFY COLUMN `plan` enum('free','starter','pro','scale') NOT NULL DEFAULT 'free';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `plan` enum('free','starter','pro','scale') NOT NULL DEFAULT 'free';--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `stripe_price_id` varchar(128);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `billing_cycle` enum('monthly','yearly');--> statement-breakpoint
ALTER TABLE `users` ADD `preferred_chat_model` enum('gemini-3-1-pro','sonnet-4-6','opus-4-6') DEFAULT 'sonnet-4-6' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `preferred_image_quality` enum('image-1k','image-2k','image-4k') DEFAULT 'image-1k' NOT NULL;
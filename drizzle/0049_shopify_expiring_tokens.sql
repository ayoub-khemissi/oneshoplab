ALTER TABLE `shop_connections` ADD `access_token_expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `shop_connections` ADD `refresh_token_expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `shop_connections` ADD `token_refresh_lock_until` timestamp;
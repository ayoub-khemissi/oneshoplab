ALTER TABLE `users` ADD `credits_balance_subscription` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `credits_balance_pack` int DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Grandfather existing balances into the pack bucket so users don't lose
-- their accrued credits when the new reset-on-renewal rule kicks in.
UPDATE `users` SET `credits_balance_pack` = `credits_balance` WHERE `credits_balance` > 0;
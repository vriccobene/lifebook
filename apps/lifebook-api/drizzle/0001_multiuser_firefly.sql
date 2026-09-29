CREATE TABLE `firefly_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`base_url` text NOT NULL,
	`token_encrypted` text NOT NULL,
	`created_at` text NOT NULL,
	`last_import_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `firefly_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`firefly_account_id` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firefly_links_user_firefly_idx` ON `firefly_links` (`user_id`,`firefly_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `firefly_links_account_idx` ON `firefly_links` (`account_id`);--> statement-breakpoint
ALTER TABLE `contributions` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `contributions_account_external_idx` ON `contributions` (`account_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
-- Before this migration there was a single user: it becomes the administrator.
UPDATE `users` SET `role` = 'admin';
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`from_account_id` text,
	`to_account_id` text,
	`from_name` text NOT NULL,
	`to_name` text NOT NULL,
	`description` text NOT NULL,
	`external_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `transfers_user_date_idx` ON `transfers` (`user_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_user_external_idx` ON `transfers` (`user_id`,`external_id`);
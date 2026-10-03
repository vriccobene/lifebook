CREATE TABLE `firefly_coverage` (
	`account_id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firefly_coverage_account_range_idx` ON `firefly_coverage` (`account_id`,`from_date`,`to_date`);--> statement-breakpoint
CREATE TABLE `firefly_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`external_id` text NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`from_account_id` text,
	`to_account_id` text,
	`from_name` text NOT NULL,
	`to_name` text NOT NULL,
	`description` text NOT NULL,
	`category_name` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firefly_movements_user_external_idx` ON `firefly_movements` (`user_id`,`external_id`);
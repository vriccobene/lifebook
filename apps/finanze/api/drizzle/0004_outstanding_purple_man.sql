CREATE TABLE `movement_annotations` (
	`user_id` text NOT NULL,
	`external_id` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`included` integer DEFAULT true NOT NULL,
	`spending_class` text DEFAULT 'unclassified' NOT NULL,
	`is_yield` integer DEFAULT false NOT NULL,
	`gross_cents` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movement_annotations_user_external_idx` ON `movement_annotations` (`user_id`,`external_id`);
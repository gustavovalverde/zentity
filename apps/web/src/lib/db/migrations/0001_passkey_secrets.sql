ALTER TABLE `onboarding_sessions` ADD COLUMN `keys_secured` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `encrypted_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret_type` text NOT NULL,
	`encrypted_blob` text NOT NULL,
	`metadata` text,
	`version` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_encrypted_secrets_user_id` ON `encrypted_secrets` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_encrypted_secrets_type` ON `encrypted_secrets` (`secret_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `encrypted_secrets_user_secret_type_unique` ON `encrypted_secrets` (`user_id`,`secret_type`);
--> statement-breakpoint
CREATE TABLE `secret_wrappers` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_id` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`wrapped_dek` text NOT NULL,
	`prf_salt` text NOT NULL,
	`kek_version` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`secret_id`) REFERENCES `encrypted_secrets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_secret_wrappers_user_id` ON `secret_wrappers` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_secret_wrappers_credential_id` ON `secret_wrappers` (`credential_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `secret_wrappers_secret_credential_unique` ON `secret_wrappers` (`secret_id`,`credential_id`);

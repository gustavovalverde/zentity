-- Passkey credentials for authentication
-- Stores WebAuthn public keys for passkey-first authentication
CREATE TABLE `passkey_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`device_type` text,
	`backed_up` integer DEFAULT false NOT NULL,
	`transports` text,
	`name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_passkey_credentials_user_id` ON `passkey_credentials` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credentials_credential_id_unique` ON `passkey_credentials` (`credential_id`);
--> statement-breakpoint
-- Track if user was created passwordless
ALTER TABLE `user` ADD COLUMN `passwordless_signup` integer DEFAULT false NOT NULL;

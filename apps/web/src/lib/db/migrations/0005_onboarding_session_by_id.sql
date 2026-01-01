-- Migration: Change onboarding sessions from email-based to sessionId-based
-- This allows multiple sessions per email and prevents session bleeding between users
--
-- SQLite doesn't support ALTER COLUMN, so we recreate the table to:
-- 1. Remove NOT NULL constraint from email
-- 2. Drop the unique index on email

-- Create new table with email as nullable
CREATE TABLE `onboarding_sessions_new` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`step` integer DEFAULT 1 NOT NULL,
	`encrypted_pii` text,
	`document_hash` text,
	`identity_draft_id` text,
	`document_processed` integer DEFAULT false NOT NULL,
	`liveness_passed` integer DEFAULT false NOT NULL,
	`face_match_passed` integer DEFAULT false NOT NULL,
	`keys_secured` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL
);--> statement-breakpoint

-- Copy existing data
INSERT INTO `onboarding_sessions_new`
SELECT `id`, `email`, `step`, `encrypted_pii`, `document_hash`, `identity_draft_id`,
       `document_processed`, `liveness_passed`, `face_match_passed`, `keys_secured`,
       `created_at`, `updated_at`, `expires_at`
FROM `onboarding_sessions`;--> statement-breakpoint

-- Drop old table (this also drops the unique index)
DROP TABLE `onboarding_sessions`;--> statement-breakpoint

-- Rename new table
ALTER TABLE `onboarding_sessions_new` RENAME TO `onboarding_sessions`;--> statement-breakpoint

-- Recreate indexes (non-unique email index for cleanup queries)
CREATE INDEX `idx_onboarding_sessions_expires_at` ON `onboarding_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_sessions_email` ON `onboarding_sessions` (`email`);

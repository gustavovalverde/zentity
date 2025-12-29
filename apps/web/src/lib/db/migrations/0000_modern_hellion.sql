CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` text,
	`refreshTokenExpiresAt` text,
	`scope` text,
	`password` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` text NOT NULL,
	`token` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer NOT NULL,
	`image` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `identity_bundles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`wallet_address` text,
	`status` text DEFAULT 'pending',
	`policy_version` text,
	`issuer_id` text,
	`attestation_expires_at` text,
	`fhe_key_id` text,
	`fhe_public_key` text,
	`fhe_status` text,
	`fhe_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_identity_bundles_status` ON `identity_bundles` (`status`);--> statement-breakpoint
CREATE TABLE `identity_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_type` text,
	`issuer_country` text,
	`document_hash` text,
	`name_commitment` text,
	`user_salt` text,
	`birth_year_offset` integer,
	`first_name_encrypted` text,
	`verified_at` text,
	`confidence_score` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_documents_document_hash_unique` ON `identity_documents` (`document_hash`);--> statement-breakpoint
CREATE INDEX `idx_identity_documents_user_id` ON `identity_documents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_identity_documents_doc_hash` ON `identity_documents` (`document_hash`);--> statement-breakpoint
CREATE TABLE `encrypted_attributes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`attribute_type` text NOT NULL,
	`ciphertext` text NOT NULL,
	`key_id` text,
	`encryption_time_ms` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_encrypted_attributes_user_id` ON `encrypted_attributes` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_encrypted_attributes_type` ON `encrypted_attributes` (`attribute_type`);--> statement-breakpoint
CREATE TABLE `signed_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text,
	`claim_type` text NOT NULL,
	`claim_payload` text NOT NULL,
	`signature` text NOT NULL,
	`issued_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_signed_claims_user_id` ON `signed_claims` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_signed_claims_type` ON `signed_claims` (`claim_type`);--> statement-breakpoint
CREATE TABLE `zk_challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`circuit_type` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_zk_challenges_expires_at` ON `zk_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `zk_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text,
	`proof_type` text NOT NULL,
	`proof_hash` text NOT NULL,
	`proof_payload` text,
	`public_inputs` text,
	`is_over_18` integer,
	`generation_time_ms` integer,
	`nonce` text,
	`policy_version` text,
	`circuit_type` text,
	`noir_version` text,
	`circuit_hash` text,
	`bb_version` text,
	`verified` integer DEFAULT false,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_zk_proofs_user_id` ON `zk_proofs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_zk_proofs_type` ON `zk_proofs` (`proof_type`);--> statement-breakpoint
CREATE INDEX `idx_zk_proofs_document_id` ON `zk_proofs` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_zk_proofs_hash` ON `zk_proofs` (`proof_hash`);--> statement-breakpoint
CREATE TABLE `attestation_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text NOT NULL,
	`policy_version` text,
	`policy_hash` text,
	`proof_set_hash` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attestation_evidence_user_id` ON `attestation_evidence` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_attestation_evidence_document_id` ON `attestation_evidence` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attestation_evidence_user_document_unique` ON `attestation_evidence` (`user_id`,`document_id`);--> statement-breakpoint
CREATE TABLE `blockchain_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`network_id` text NOT NULL,
	`chain_id` integer NOT NULL,
	`status` text DEFAULT 'pending',
	`tx_hash` text,
	`block_number` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`confirmed_at` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_attestations_user_id` ON `blockchain_attestations` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_attestations_network` ON `blockchain_attestations` (`network_id`);--> statement-breakpoint
CREATE INDEX `idx_attestations_status` ON `blockchain_attestations` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `blockchain_attestations_user_network_unique` ON `blockchain_attestations` (`user_id`,`network_id`);--> statement-breakpoint
CREATE TABLE `onboarding_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`step` integer DEFAULT 1 NOT NULL,
	`encrypted_pii` text,
	`document_hash` text,
	`document_processed` integer DEFAULT false NOT NULL,
	`liveness_passed` integer DEFAULT false NOT NULL,
	`face_match_passed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_sessions_email_unique` ON `onboarding_sessions` (`email`);--> statement-breakpoint
CREATE INDEX `idx_onboarding_sessions_expires_at` ON `onboarding_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rp_authorization_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`state` text,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rp_authorization_codes_expires_at` ON `rp_authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_rp_authorization_codes_user_id` ON `rp_authorization_codes` (`user_id`);

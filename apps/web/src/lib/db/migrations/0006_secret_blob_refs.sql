ALTER TABLE encrypted_secrets ADD COLUMN blob_ref TEXT;
ALTER TABLE encrypted_secrets ADD COLUMN blob_hash TEXT;
ALTER TABLE encrypted_secrets ADD COLUMN blob_size INTEGER;

//! ReDB storage implementation for the signer service.
//!
//! Provides persistent storage for:
//! - DKG sessions (coordinator)
//! - Signing sessions (coordinator)
//! - Key shares (signer)
//!
//! Each table uses string keys and JSON-serialized values for simplicity.

use std::path::Path;
use std::sync::Arc;

use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{Serialize, de::DeserializeOwned};

use crate::error::{SignerError, SignerResult};

// Table definitions
// Using string keys and byte values (JSON serialized)
const DKG_SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("dkg_sessions");
const SIGNING_SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("signing_sessions");
const GROUP_KEYS: TableDefinition<&str, &[u8]> = TableDefinition::new("group_keys");
const KEY_SHARES: TableDefinition<&str, &[u8]> = TableDefinition::new("key_shares");
const AUDIT_LOG: TableDefinition<u64, &[u8]> = TableDefinition::new("audit_log");

/// Storage wrapper for ReDB.
///
/// Thread-safe via internal Arc. Clone is cheap.
#[derive(Clone)]
pub struct Storage {
    db: Arc<Database>,
}

impl Storage {
    /// Open or create a database at the given path.
    ///
    /// Creates parent directories if they don't exist.
    pub fn open(path: &Path) -> SignerResult<Self> {
        // Create parent directories if they don't exist
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let db = Database::create(path).map_err(|e| SignerError::Storage(e.to_string()))?;

        // Initialize tables
        let write_txn = db.begin_write()?;
        {
            // Just opening the tables creates them if they don't exist
            let _ = write_txn.open_table(DKG_SESSIONS)?;
            let _ = write_txn.open_table(SIGNING_SESSIONS)?;
            let _ = write_txn.open_table(GROUP_KEYS)?;
            let _ = write_txn.open_table(KEY_SHARES)?;
            let _ = write_txn.open_table(AUDIT_LOG)?;
        }
        write_txn.commit()?;

        tracing::info!(path = %path.display(), "Opened storage database");

        Ok(Self { db: Arc::new(db) })
    }

    /// Open an in-memory database for testing.
    #[cfg(test)]
    pub fn open_memory() -> SignerResult<Self> {
        let db = Database::builder()
            .create_with_backend(redb::backends::InMemoryBackend::new())
            .map_err(|e| SignerError::Storage(e.to_string()))?;

        let write_txn = db.begin_write()?;
        {
            let _ = write_txn.open_table(DKG_SESSIONS)?;
            let _ = write_txn.open_table(SIGNING_SESSIONS)?;
            let _ = write_txn.open_table(GROUP_KEYS)?;
            let _ = write_txn.open_table(KEY_SHARES)?;
            let _ = write_txn.open_table(AUDIT_LOG)?;
        }
        write_txn.commit()?;

        Ok(Self { db: Arc::new(db) })
    }

    // =========================================================================
    // DKG Sessions (Coordinator)
    // =========================================================================

    /// Store a DKG session.
    pub fn put_dkg_session<T: Serialize>(&self, session_id: &str, session: &T) -> SignerResult<()> {
        let value = serde_json::to_vec(session)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(DKG_SESSIONS)?;
            table.insert(session_id, value.as_slice())?;
        }
        write_txn.commit()?;
        tracing::debug!(session_id, "Stored DKG session");
        Ok(())
    }

    /// Get a DKG session by ID.
    pub fn get_dkg_session<T: DeserializeOwned>(
        &self,
        session_id: &str,
    ) -> SignerResult<Option<T>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(DKG_SESSIONS)?;

        match table.get(session_id)? {
            Some(value) => {
                let session: T = serde_json::from_slice(value.value())?;
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    /// Delete a DKG session.
    pub fn delete_dkg_session(&self, session_id: &str) -> SignerResult<bool> {
        let write_txn = self.db.begin_write()?;
        let deleted = {
            let mut table = write_txn.open_table(DKG_SESSIONS)?;
            table.remove(session_id)?.is_some()
        };
        write_txn.commit()?;

        if deleted {
            tracing::debug!(session_id, "Deleted DKG session");
        }
        Ok(deleted)
    }

    // =========================================================================
    // Signing Sessions (Coordinator)
    // =========================================================================

    /// Store a signing session.
    pub fn put_signing_session<T: Serialize>(
        &self,
        session_id: &str,
        session: &T,
    ) -> SignerResult<()> {
        let value = serde_json::to_vec(session)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(SIGNING_SESSIONS)?;
            table.insert(session_id, value.as_slice())?;
        }
        write_txn.commit()?;
        tracing::debug!(session_id, "Stored signing session");
        Ok(())
    }

    /// Get a signing session by ID.
    pub fn get_signing_session<T: DeserializeOwned>(
        &self,
        session_id: &str,
    ) -> SignerResult<Option<T>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(SIGNING_SESSIONS)?;

        match table.get(session_id)? {
            Some(value) => {
                let session: T = serde_json::from_slice(value.value())?;
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    /// Delete a signing session.
    pub fn delete_signing_session(&self, session_id: &str) -> SignerResult<bool> {
        let write_txn = self.db.begin_write()?;
        let deleted = {
            let mut table = write_txn.open_table(SIGNING_SESSIONS)?;
            table.remove(session_id)?.is_some()
        };
        write_txn.commit()?;

        if deleted {
            tracing::debug!(session_id, "Deleted signing session");
        }
        Ok(deleted)
    }

    // =========================================================================
    // Group Keys (Coordinator)
    // =========================================================================

    /// Store a group key record keyed by group public key.
    pub fn put_group_key<T: Serialize>(&self, group_pubkey: &str, record: &T) -> SignerResult<()> {
        let value = serde_json::to_vec(record)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(GROUP_KEYS)?;
            table.insert(group_pubkey, value.as_slice())?;
        }
        write_txn.commit()?;
        tracing::debug!(group_pubkey, "Stored group key record");
        Ok(())
    }

    /// Get a group key record by group public key.
    pub fn get_group_key<T: DeserializeOwned>(
        &self,
        group_pubkey: &str,
    ) -> SignerResult<Option<T>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(GROUP_KEYS)?;

        match table.get(group_pubkey)? {
            Some(value) => {
                let record: T = serde_json::from_slice(value.value())?;
                Ok(Some(record))
            }
            None => Ok(None),
        }
    }

    // =========================================================================
    // Key Shares (Signer)
    // =========================================================================

    /// Store an encrypted key share.
    ///
    /// Key format: `{user_id}:{participant_id}` or `{group_id}:{participant_id}`
    pub fn put_key_share(&self, key: &str, encrypted_share: &[u8]) -> SignerResult<()> {
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(KEY_SHARES)?;
            table.insert(key, encrypted_share)?;
        }
        write_txn.commit()?;
        tracing::debug!(key, "Stored key share");
        Ok(())
    }

    /// Get an encrypted key share.
    pub fn get_key_share(&self, key: &str) -> SignerResult<Option<Vec<u8>>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(KEY_SHARES)?;

        Ok(table.get(key)?.map(|v| v.value().to_vec()))
    }

    /// Delete a key share.
    pub fn delete_key_share(&self, key: &str) -> SignerResult<bool> {
        let write_txn = self.db.begin_write()?;
        let deleted = {
            let mut table = write_txn.open_table(KEY_SHARES)?;
            table.remove(key)?.is_some()
        };
        write_txn.commit()?;

        if deleted {
            tracing::debug!(key, "Deleted key share");
        }
        Ok(deleted)
    }

    /// List all key share keys (for debugging/admin).
    pub fn list_key_share_keys(&self) -> SignerResult<Vec<String>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(KEY_SHARES)?;

        let keys: Vec<String> = table
            .iter()?
            .filter_map(|entry| entry.ok().map(|(k, _)| k.value().to_string()))
            .collect();

        Ok(keys)
    }

    // =========================================================================
    // Audit Log
    // =========================================================================

    /// Append an entry to the audit log.
    ///
    /// Returns the sequence number of the entry.
    pub fn append_audit_log<T: Serialize>(&self, entry: &T) -> SignerResult<u64> {
        let value = serde_json::to_vec(entry)?;
        let write_txn = self.db.begin_write()?;

        let seq = {
            let mut table = write_txn.open_table(AUDIT_LOG)?;

            // Get the next sequence number
            let seq = table
                .iter()?
                .last()
                .transpose()?
                .map_or(0, |(k, _)| k.value() + 1);

            table.insert(seq, value.as_slice())?;
            seq
        };

        write_txn.commit()?;
        tracing::trace!(seq, "Appended audit log entry");
        Ok(seq)
    }

    /// Get audit log entries in a range.
    pub fn get_audit_log_range<T: DeserializeOwned>(
        &self,
        start: u64,
        end: u64,
    ) -> SignerResult<Vec<(u64, T)>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(AUDIT_LOG)?;

        let entries: Result<Vec<_>, _> = table
            .range(start..end)?
            .map(|entry| {
                let (k, v) = entry?;
                let parsed: T = serde_json::from_slice(v.value())?;
                Ok((k.value(), parsed))
            })
            .collect();

        entries
    }

    /// Get the latest audit log sequence number.
    pub fn get_audit_log_latest_seq(&self) -> SignerResult<Option<u64>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(AUDIT_LOG)?;

        let latest = table.iter()?.last().transpose()?.map(|(k, _)| k.value());

        Ok(latest)
    }

    /// Get the latest audit sequence number (alias for hash-chained audit log).
    pub fn get_latest_audit_seq(&self) -> SignerResult<Option<u64>> {
        self.get_audit_log_latest_seq()
    }

    /// Store a single audit entry by sequence number.
    pub fn put_audit_entry<T>(&self, entry: &T) -> SignerResult<()>
    where
        T: Serialize + AsRef<crate::audit::AuditEntry>,
    {
        let audit_entry = entry.as_ref();
        let value = serde_json::to_vec(audit_entry)?;
        let write_txn = self.db.begin_write()?;
        {
            let mut table = write_txn.open_table(AUDIT_LOG)?;
            table.insert(audit_entry.seq, value.as_slice())?;
        }
        write_txn.commit()?;
        tracing::trace!(seq = audit_entry.seq, "Stored audit entry");
        Ok(())
    }

    /// Get a single audit entry by sequence number.
    pub fn get_audit_entry(&self, seq: u64) -> SignerResult<Option<crate::audit::AuditEntry>> {
        let read_txn = self.db.begin_read()?;
        let table = read_txn.open_table(AUDIT_LOG)?;

        match table.get(seq)? {
            Some(value) => {
                let entry: crate::audit::AuditEntry = serde_json::from_slice(value.value())?;
                Ok(Some(entry))
            }
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct TestSession {
        id: String,
        status: String,
    }

    #[test]
    fn test_dkg_session_crud() -> SignerResult<()> {
        let storage = Storage::open_memory()?;

        let session = TestSession {
            id: "test-1".to_string(),
            status: "pending".to_string(),
        };

        // Create
        storage.put_dkg_session("test-1", &session)?;

        // Read
        let retrieved: Option<TestSession> = storage.get_dkg_session("test-1")?;
        assert_eq!(retrieved, Some(session));

        // Delete
        assert!(storage.delete_dkg_session("test-1")?);
        assert!(storage.get_dkg_session::<TestSession>("test-1")?.is_none());

        Ok(())
    }

    #[test]
    fn test_key_share_crud() -> SignerResult<()> {
        let storage = Storage::open_memory()?;

        let key = "user-1:participant-1";
        let share = b"encrypted-share-data";

        // Create
        storage.put_key_share(key, share)?;

        // Read
        let retrieved = storage.get_key_share(key)?;
        assert_eq!(retrieved, Some(share.to_vec()));

        // List
        let keys = storage.list_key_share_keys()?;
        assert!(keys.contains(&key.to_string()));

        // Delete
        assert!(storage.delete_key_share(key)?);
        assert!(storage.get_key_share(key)?.is_none());

        Ok(())
    }

    #[test]
    fn test_audit_log() -> SignerResult<()> {
        #[derive(Debug, Serialize, Deserialize, PartialEq)]
        struct AuditEntry {
            event: String,
        }

        let storage = Storage::open_memory()?;

        // Append entries
        let seq1 = storage.append_audit_log(&AuditEntry {
            event: "first".to_string(),
        })?;
        let seq2 = storage.append_audit_log(&AuditEntry {
            event: "second".to_string(),
        })?;

        assert_eq!(seq1, 0);
        assert_eq!(seq2, 1);

        // Get latest
        assert_eq!(storage.get_audit_log_latest_seq()?, Some(1));

        // Get range
        let entries: Vec<(u64, AuditEntry)> = storage.get_audit_log_range(0, 10)?;
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].1.event, "first");
        assert_eq!(entries[1].1.event, "second");

        Ok(())
    }
}

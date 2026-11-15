//! FHE Key Management
//!
//! Handles registration, storage, and retrieval of server keys derived from
//! client-owned keypairs. Client keys never leave the browser.

use once_cell::sync::OnceCell;
use redb::{Database, ReadableDatabase, TableDefinition, TableHandle};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Instant;
use tfhe::named::Named;
use tfhe::{set_server_key, CompressedPublicKey, CompressedServerKey, ServerKey, Unversionize};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::error::FheError;

/// Global key storage
static KEYS: OnceCell<KeyStore> = OnceCell::new();

const DEFAULT_KEYS_DIR: &str = "/var/lib/zentity/fhe";
const KEYSTORE_FILE_NAME: &str = "keystore.redb";

const PUBLIC_KEYS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("public_keys");
const SERVER_KEYS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("server_keys");

/// Global FHE server key storage with thread-safe access.
///
/// # Thread Safety
/// - `server_keys`: Decompressed keys cached in memory for verification
/// - `server_keys_compressed`: Compressed keys cached in memory
/// - `public_keys`: Public keys cached in memory
/// - `db`: redb store for persistence
pub struct KeyStore {
    pub(crate) server_keys: RwLock<HashMap<String, ServerKey>>,
    pub(crate) server_keys_compressed: RwLock<HashMap<String, CompressedServerKey>>,
    pub(crate) public_keys: RwLock<HashMap<String, CompressedPublicKey>>,
    pub(crate) db: Database,
}

/// Caches only ever gain entries, so a panic while one is locked cannot leave
/// it inconsistent; keep serving from the inner state instead of failing.
fn read_cache<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|error| {
        warn!("Key cache lock poisoned; continuing with inner state");
        error.into_inner()
    })
}

fn write_cache<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(|error| {
        warn!("Key cache lock poisoned; continuing with inner state");
        error.into_inner()
    })
}

pub fn decode_compressed_public_key(
    public_key_bytes: &[u8],
) -> Result<CompressedPublicKey, FheError> {
    super::decode_tfhe_binary(public_key_bytes)
}

pub fn decode_compressed_server_key(
    server_key_bytes: &[u8],
) -> Result<CompressedServerKey, FheError> {
    super::decode_tfhe_binary(server_key_bytes)
}

impl KeyStore {
    fn resolve_keys_dir() -> PathBuf {
        std::env::var("FHE_KEYS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_KEYS_DIR))
    }

    fn keystore_path(keys_dir: &Path) -> PathBuf {
        keys_dir.join(KEYSTORE_FILE_NAME)
    }

    fn open_db(keys_dir: &Path) -> Result<Database, FheError> {
        std::fs::create_dir_all(keys_dir).map_err(|error| {
            FheError::Internal(format!(
                "Failed to create FHE keys directory {}: {error}",
                keys_dir.display()
            ))
        })?;
        let path = Self::keystore_path(keys_dir);
        let db = Database::create(&path).map_err(|error| {
            FheError::Internal(format!(
                "Failed to open redb keystore at {}: {error}",
                path.display()
            ))
        })?;

        Self::init_db(&db).map_err(|error| {
            FheError::Internal(format!(
                "Failed to initialize redb keystore at {}: {error}",
                path.display()
            ))
        })?;

        Ok(db)
    }

    fn init_db(db: &Database) -> Result<(), redb::Error> {
        let write_txn = db.begin_write()?;
        write_txn.open_table(PUBLIC_KEYS_TABLE)?;
        write_txn.open_table(SERVER_KEYS_TABLE)?;
        write_txn.commit()?;
        Ok(())
    }

    fn with_db(db: Database) -> Self {
        Self {
            server_keys: RwLock::default(),
            server_keys_compressed: RwLock::default(),
            public_keys: RwLock::default(),
            db,
        }
    }

    fn new() -> Result<Self, FheError> {
        let keys_dir = Self::resolve_keys_dir();
        let db = Self::open_db(&keys_dir)?;

        info!(
            "Loaded TFHE keys database: {}",
            Self::keystore_path(&keys_dir).display()
        );

        Ok(Self::with_db(db))
    }

    /// Open a store backed by `keys_dir`, bypassing the global store. Keys already
    /// persisted there are loaded on first use.
    pub(crate) fn new_for_tests(keys_dir: PathBuf) -> Self {
        Self::with_db(Self::open_db(&keys_dir).expect("Failed to open test keystore"))
    }

    pub(crate) fn keystore_path_for_tests(keys_dir: &Path) -> PathBuf {
        Self::keystore_path(keys_dir)
    }

    fn persist_key(
        &self,
        key_id: &str,
        public_key: &CompressedPublicKey,
        server_key: &CompressedServerKey,
    ) -> Result<u128, FheError> {
        let start = Instant::now();
        let public_bytes = tracing::info_span!("fhe.serialize_public_key", key_id = %key_id)
            .in_scope(|| super::encode_tfhe_binary(public_key))?;
        let server_bytes = tracing::info_span!("fhe.serialize_server_key", key_id = %key_id)
            .in_scope(|| super::encode_tfhe_binary(server_key))?;

        self.write_key_rows(key_id, &public_bytes, &server_bytes)
            .map_err(|error| {
                FheError::Internal(format!("Failed to persist FHE keys for {key_id}: {error}"))
            })?;

        Ok(start.elapsed().as_millis())
    }

    fn write_key_rows(
        &self,
        key_id: &str,
        public_bytes: &[u8],
        server_bytes: &[u8],
    ) -> Result<(), redb::Error> {
        let write_txn = self.db.begin_write()?;
        write_txn
            .open_table(PUBLIC_KEYS_TABLE)?
            .insert(key_id, public_bytes)?;
        write_txn
            .open_table(SERVER_KEYS_TABLE)?
            .insert(key_id, server_bytes)?;
        tracing::info_span!("fhe.persist_key.commit", key_id = %key_id)
            .in_scope(|| write_txn.commit())?;
        Ok(())
    }

    /// Read and decode one key from `table`. A missing, unreadable, or
    /// undecodable row is `None`; the cause is logged.
    fn load_from_table<T>(&self, table: TableDefinition<&str, &[u8]>, key_id: &str) -> Option<T>
    where
        T: DeserializeOwned + Unversionize + Named,
    {
        let loaded = (|| {
            let read_txn = self.db.begin_read()?;
            let rows = read_txn.open_table(table)?;
            let row = rows.get(key_id)?;
            Ok::<_, redb::Error>(row.map(|value| super::decode_tfhe_binary::<T>(value.value())))
        })();

        match loaded {
            Ok(Some(Ok(key))) => Some(key),
            Ok(Some(Err(error))) => {
                warn!(key_id = %key_id, table = table.name(), error = %error, "Failed to deserialize key");
                None
            }
            Ok(None) => None,
            Err(error) => {
                warn!(key_id = %key_id, table = table.name(), error = %error, "Failed to read key from redb");
                None
            }
        }
    }

    /// Register public + server keys derived from a client-provided keypair.
    ///
    /// Stores compressed keys immediately and persists them to disk.
    /// Validation is deferred to first use (`get_server_key`) where
    /// decompression is wrapped in `catch_unwind`. Deserialization
    /// in the HTTP handler already rejects malformed bytes with 400.
    pub fn register_key(
        &self,
        public_key: CompressedPublicKey,
        server_key: CompressedServerKey,
    ) -> Result<String, FheError> {
        let key_id = Uuid::new_v4().to_string();

        let persist_ms = self
            .persist_key(&key_id, &public_key, &server_key)
            .map_err(|error| {
                error!(key_id = %key_id, error = %error, "Failed to persist FHE keys");
                error
            })?;

        let cache_start = Instant::now();
        write_cache(&self.public_keys).insert(key_id.clone(), public_key);
        write_cache(&self.server_keys_compressed).insert(key_id.clone(), server_key);
        let cache_ms = cache_start.elapsed().as_millis();
        info!(
            key_id = %key_id,
            cache_ms = cache_ms,
            persist_ms = persist_ms,
            "Persisted FHE keys"
        );

        Ok(key_id)
    }

    /// Get a server key by ID (decompressed).
    pub fn get_server_key(&self, key_id: &str) -> Option<ServerKey> {
        if let Some(key) = read_cache(&self.server_keys).get(key_id).cloned() {
            return Some(key);
        }

        let cached_compressed = read_cache(&self.server_keys_compressed)
            .get(key_id)
            .cloned();
        let compressed = match cached_compressed {
            Some(key) => key,
            None => self.load_from_table::<CompressedServerKey>(SERVER_KEYS_TABLE, key_id)?,
        };

        let server_key_result = tracing::info_span!("fhe.decompress_server_key", key_id = %key_id)
            .in_scope(|| catch_unwind(AssertUnwindSafe(|| compressed.decompress())));
        let Ok(server_key) = server_key_result else {
            warn!(key_id = %key_id, "Server key decompression panicked");
            return None;
        };

        write_cache(&self.server_keys).insert(key_id.to_string(), server_key.clone());
        write_cache(&self.server_keys_compressed).insert(key_id.to_string(), compressed);

        Some(server_key)
    }

    /// Get a public key by ID
    pub fn get_public_key(&self, key_id: &str) -> Option<CompressedPublicKey> {
        if let Some(key) = read_cache(&self.public_keys).get(key_id).cloned() {
            return Some(key);
        }

        let key = self.load_from_table::<CompressedPublicKey>(PUBLIC_KEYS_TABLE, key_id)?;
        write_cache(&self.public_keys).insert(key_id.to_string(), key.clone());
        Some(key)
    }
}

/// Initialize the global key store
pub fn init_keys() -> Result<(), FheError> {
    KEYS.get_or_try_init(KeyStore::new).map(|_| ())
}

/// Get the global key store
pub fn get_key_store() -> &'static KeyStore {
    KEYS.get()
        .expect("Keys not initialized. Call init_keys() first.")
}

/// Sets up server key context for verification operations.
///
/// This helper eliminates repeated boilerplate across verify functions:
/// 1. Gets the global key store
/// 2. Sets the server key for this thread (required by TFHE-rs)
pub fn setup_for_verification(key_id: &str) -> Result<(), crate::error::FheError> {
    let key_store = get_key_store();
    let server_key = key_store
        .get_server_key(key_id)
        .ok_or_else(|| crate::error::FheError::KeyNotFound(key_id.to_string()))?;
    set_server_key(server_key);
    Ok(())
}

/// Fetch the public key used for encryption.
pub fn get_public_key_for_encryption(
    key_id: &str,
) -> Result<CompressedPublicKey, crate::error::FheError> {
    let key_store = get_key_store();
    key_store
        .get_public_key(key_id)
        .ok_or_else(|| crate::error::FheError::KeyNotFound(key_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tfhe::{ClientKey, ConfigBuilder};

    #[test]
    fn register_key_defers_server_key_decompression() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = KeyStore::new_for_tests(dir.path().to_path_buf());
        let client_key = ClientKey::generate(ConfigBuilder::default().build());

        let key_id = store
            .register_key(
                CompressedPublicKey::new(&client_key),
                CompressedServerKey::new(&client_key),
            )
            .expect("register key");

        assert!(store
            .server_keys_compressed
            .read()
            .unwrap()
            .contains_key(&key_id));
        assert!(!store.server_keys.read().unwrap().contains_key(&key_id));

        assert!(store.get_server_key(&key_id).is_some());
        assert!(store.server_keys.read().unwrap().contains_key(&key_id));
    }

    #[test]
    fn register_key_survives_poisoned_cache_lock() {
        let dir = tempfile::tempdir().expect("temp dir");
        let store = KeyStore::new_for_tests(dir.path().to_path_buf());
        let client_key = ClientKey::generate(ConfigBuilder::default().build());

        let panicked = catch_unwind(AssertUnwindSafe(|| {
            let _guard = store.public_keys.write().unwrap();
            panic!("poison the public key cache");
        }));
        assert!(panicked.is_err());
        assert!(store.public_keys.is_poisoned());

        let key_id = store
            .register_key(
                CompressedPublicKey::new(&client_key),
                CompressedServerKey::new(&client_key),
            )
            .expect("register key with a poisoned cache lock");

        assert!(store.get_public_key(&key_id).is_some());
    }
}

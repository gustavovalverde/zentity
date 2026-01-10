//! FHE Key Management
//!
//! Handles registration, storage, and retrieval of server keys derived from
//! client-owned keypairs. Client keys never leave the browser.

use once_cell::sync::OnceCell;
use redb::{Database, ReadableDatabase, TableDefinition};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Instant;
use tfhe::{set_server_key, CompressedPublicKey, CompressedServerKey, ServerKey};
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

    fn new() -> Result<Self, FheError> {
        let keys_dir = Self::resolve_keys_dir();
        let db = Self::open_db(&keys_dir)?;

        info!(
            "Loaded TFHE keys database: {}",
            Self::keystore_path(&keys_dir).display()
        );

        Ok(Self {
            server_keys: RwLock::new(HashMap::new()),
            server_keys_compressed: RwLock::new(HashMap::new()),
            public_keys: RwLock::new(HashMap::new()),
            db,
        })
    }

    pub(crate) fn new_for_tests(keys_dir: PathBuf) -> Self {
        let db = Self::open_db(&keys_dir).expect("Failed to open test keystore");
        KeyStore {
            server_keys: RwLock::new(HashMap::new()),
            server_keys_compressed: RwLock::new(HashMap::new()),
            public_keys: RwLock::new(HashMap::new()),
            db,
        }
    }

    pub(crate) fn load_for_tests(keys_dir: PathBuf) -> Self {
        let db = Self::open_db(&keys_dir).expect("Failed to open test keystore");
        KeyStore {
            server_keys: RwLock::new(HashMap::new()),
            server_keys_compressed: RwLock::new(HashMap::new()),
            public_keys: RwLock::new(HashMap::new()),
            db,
        }
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
            .in_scope(|| bincode::serialize(public_key))?;
        let server_bytes = tracing::info_span!("fhe.serialize_server_key", key_id = %key_id)
            .in_scope(|| bincode::serialize(server_key))?;

        let write_txn = self.db.begin_write().map_err(|error| {
            FheError::Internal(format!(
                "Failed to start redb write transaction for {key_id}: {error}"
            ))
        })?;

        {
            let mut public_table = write_txn.open_table(PUBLIC_KEYS_TABLE).map_err(|error| {
                FheError::Internal(format!(
                    "Failed to open public key table for {key_id}: {error}"
                ))
            })?;
            public_table
                .insert(key_id, public_bytes.as_slice())
                .map_err(|error| {
                    FheError::Internal(format!(
                        "Failed to persist public key for {key_id}: {error}"
                    ))
                })?;

            let mut server_table = write_txn.open_table(SERVER_KEYS_TABLE).map_err(|error| {
                FheError::Internal(format!(
                    "Failed to open server key table for {key_id}: {error}"
                ))
            })?;
            server_table
                .insert(key_id, server_bytes.as_slice())
                .map_err(|error| {
                    FheError::Internal(format!(
                        "Failed to persist server key for {key_id}: {error}"
                    ))
                })?;
        }

        tracing::info_span!("fhe.persist_key.commit", key_id = %key_id).in_scope(|| {
            write_txn.commit().map_err(|error| {
                FheError::Internal(format!(
                    "Failed to commit key persistence for {key_id}: {error}"
                ))
            })
        })?;

        Ok(start.elapsed().as_millis())
    }

    fn load_public_key_from_db(&self, key_id: &str) -> Option<CompressedPublicKey> {
        let read_txn = match self.db.begin_read() {
            Ok(txn) => txn,
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to open redb read transaction");
                return None;
            }
        };
        let table = match read_txn.open_table(PUBLIC_KEYS_TABLE) {
            Ok(table) => table,
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to open public key table");
                return None;
            }
        };
        let value = match table.get(key_id) {
            Ok(value) => value,
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to read public key from table");
                return None;
            }
        }?;
        let bytes = value.value();
        match bincode::deserialize(bytes) {
            Ok(key) => Some(key),
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to deserialize public key");
                None
            }
        }
    }

    fn load_compressed_server_key_from_db(&self, key_id: &str) -> Option<CompressedServerKey> {
        let read_txn = match self.db.begin_read() {
            Ok(txn) => txn,
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to open redb read transaction");
                return None;
            }
        };
        let table = match read_txn.open_table(SERVER_KEYS_TABLE) {
            Ok(table) => table,
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to open server key table");
                return None;
            }
        };
        let value = match table.get(key_id) {
            Ok(value) => value,
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to read server key from table");
                return None;
            }
        }?;
        let bytes = value.value();
        match bincode::deserialize(bytes) {
            Ok(key) => Some(key),
            Err(error) => {
                warn!(key_id = %key_id, error = %error, "Failed to deserialize server key");
                None
            }
        }
    }

    /// Register public + server keys derived from a client-provided keypair.
    ///
    /// Stores compressed keys immediately and persists them to disk.
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
        let mut public_keys = self
            .public_keys
            .write()
            .map_err(|_| FheError::Internal("Public key store lock poisoned".to_string()))?;
        public_keys.insert(key_id.clone(), public_key);

        let mut server_keys_compressed = self
            .server_keys_compressed
            .write()
            .map_err(|_| FheError::Internal("Server key store lock poisoned".to_string()))?;
        server_keys_compressed.insert(key_id.clone(), server_key);
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
        if let Some(key) = self
            .server_keys
            .read()
            .expect("RwLock poisoned - concurrent panic occurred")
            .get(key_id)
            .cloned()
        {
            return Some(key);
        }

        let compressed = {
            if let Some(key) = self
                .server_keys_compressed
                .read()
                .expect("RwLock poisoned - concurrent panic occurred")
                .get(key_id)
                .cloned()
            {
                Some(key)
            } else {
                self.load_compressed_server_key_from_db(key_id)
            }
        };

        let compressed = compressed?;
        let server_key = tracing::info_span!("fhe.decompress_server_key", key_id = %key_id)
            .in_scope(|| compressed.decompress());

        self.server_keys
            .write()
            .expect("RwLock poisoned - concurrent panic occurred")
            .insert(key_id.to_string(), server_key.clone());
        self.server_keys_compressed
            .write()
            .expect("RwLock poisoned - concurrent panic occurred")
            .insert(key_id.to_string(), compressed);

        Some(server_key)
    }

    /// Get a public key by ID
    pub fn get_public_key(&self, key_id: &str) -> Option<CompressedPublicKey> {
        if let Some(key) = self
            .public_keys
            .read()
            .expect("RwLock poisoned - concurrent panic occurred")
            .get(key_id)
            .cloned()
        {
            return Some(key);
        }

        let key = self.load_public_key_from_db(key_id)?;
        self.public_keys
            .write()
            .expect("RwLock poisoned - concurrent panic occurred")
            .insert(key_id.to_string(), key.clone());
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

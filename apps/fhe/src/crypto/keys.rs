//! FHE Key Management
//!
//! Handles registration, storage, and retrieval of server keys derived from
//! client-owned keypairs. Client keys never leave the browser.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tfhe::{set_server_key, CompressedPublicKey, CompressedServerKey, ServerKey};
use tracing::{info, warn};
use uuid::Uuid;

use crate::error::FheError;

/// Global key storage
static KEYS: OnceCell<KeyStore> = OnceCell::new();

const DEFAULT_KEYS_DIR: &str = "/var/lib/zentity/fhe";
const KEYSTORE_FILE_NAME: &str = "keystore.bincode";

#[derive(Serialize, Deserialize)]
struct PersistedKeyStore {
    server_keys: HashMap<String, ServerKey>,
}

/// Global FHE server key storage with thread-safe access.
///
/// # Thread Safety
/// - `server_keys`: Protected by RwLock for concurrent read access during verification
/// - `keys_dir`: If Some, keys are persisted atomically to disk
pub struct KeyStore {
    server_keys: RwLock<HashMap<String, ServerKey>>,
    keys_dir: Option<PathBuf>,
}

pub fn decode_compressed_public_key(public_key_b64: &str) -> Result<CompressedPublicKey, FheError> {
    let bytes = BASE64.decode(public_key_b64)?;
    let key: CompressedPublicKey = bincode::deserialize(&bytes)?;
    Ok(key)
}

pub fn decode_compressed_server_key(server_key_b64: &str) -> Result<CompressedServerKey, FheError> {
    let bytes = BASE64.decode(server_key_b64)?;
    let key: CompressedServerKey = bincode::deserialize(&bytes)?;
    Ok(key)
}

pub fn decode_server_key(server_key_b64: &str) -> Result<ServerKey, FheError> {
    Ok(decode_compressed_server_key(server_key_b64)?.decompress())
}

impl KeyStore {
    fn resolve_keys_dir() -> Option<PathBuf> {
        if let Ok(dir) = std::env::var("FHE_KEYS_DIR") {
            let path = PathBuf::from(dir);
            if let Err(error) = std::fs::create_dir_all(&path) {
                warn!("FHE_KEYS_DIR is set but could not be created: {error}");
                return None;
            }
            return Some(path);
        }

        let default_path = PathBuf::from(DEFAULT_KEYS_DIR);
        if default_path.is_dir() {
            Some(default_path)
        } else {
            None
        }
    }

    fn keystore_path(keys_dir: &Path) -> PathBuf {
        keys_dir.join(KEYSTORE_FILE_NAME)
    }

    fn try_load_from_disk(keys_dir: &Path) -> Option<PersistedKeyStore> {
        let path = Self::keystore_path(keys_dir);
        let bytes = std::fs::read(&path).ok()?;
        let parsed: PersistedKeyStore = bincode::deserialize(&bytes).ok()?;
        Some(parsed)
    }

    fn try_persist_to_disk(&self) {
        let Some(keys_dir) = self.keys_dir.as_ref() else {
            return;
        };

        let payload = PersistedKeyStore {
            server_keys: self
                .server_keys
                .read()
                .expect("RwLock poisoned - concurrent panic occurred")
                .clone(),
        };

        let bytes = match bincode::serialize(&payload) {
            Ok(value) => value,
            Err(error) => {
                warn!("Failed to serialize keystore for persistence: {error}");
                return;
            }
        };

        let path = Self::keystore_path(keys_dir);
        let tmp_path = keys_dir.join(format!("{KEYSTORE_FILE_NAME}.tmp"));

        if let Err(error) = std::fs::write(&tmp_path, &bytes) {
            warn!("Failed to write keystore tmp file: {error}");
            return;
        }

        if let Err(error) = std::fs::rename(&tmp_path, &path) {
            warn!("Failed to atomically persist keystore: {error}");
            let _ = std::fs::remove_file(&tmp_path);
        }
    }

    fn new() -> Self {
        let keys_dir = Self::resolve_keys_dir();

        if let Some(keys_dir) = keys_dir.as_ref() {
            if let Some(persisted) = Self::try_load_from_disk(keys_dir) {
                info!("Loaded TFHE keys from disk: {}", keys_dir.display());
                return Self {
                    server_keys: RwLock::new(persisted.server_keys),
                    keys_dir: Some(keys_dir.clone()),
                };
            }
            warn!(
                "No persisted TFHE keys found at {}; generating new keys",
                Self::keystore_path(keys_dir).display()
            );
        }

        let store = Self {
            server_keys: RwLock::new(HashMap::new()),
            keys_dir,
        };

        store.try_persist_to_disk();

        store
    }

    /// Register a server key derived from a client-provided keypair.
    pub fn register_server_key(&self, server_key: ServerKey) -> String {
        let key_id = Uuid::new_v4().to_string();
        self.server_keys
            .write()
            .expect("RwLock poisoned - concurrent panic occurred")
            .insert(key_id.clone(), server_key);

        self.try_persist_to_disk();
        key_id
    }

    /// Get a server key by ID
    pub fn get_server_key(&self, key_id: &str) -> Option<ServerKey> {
        self.server_keys
            .read()
            .expect("RwLock poisoned - concurrent panic occurred")
            .get(key_id)
            .cloned()
    }
}

/// Initialize the global key store
pub fn init_keys() {
    KEYS.get_or_init(KeyStore::new);
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

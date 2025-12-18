//! FHE Key Management
//!
//! Handles generation, storage, and retrieval of FHE keys.

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tfhe::{generate_keys, set_server_key, ClientKey, ConfigBuilder, ServerKey};
use tracing::{info, warn};
use uuid::Uuid;

/// Global key storage
static KEYS: OnceCell<KeyStore> = OnceCell::new();

const DEFAULT_KEYS_DIR: &str = "/var/lib/zentity/fhe";
const KEYSTORE_FILE_NAME: &str = "keystore.bincode";

#[derive(Serialize, Deserialize)]
struct PersistedKeyStore {
    client_keys: HashMap<String, ClientKey>,
    server_key: ServerKey,
}

/// Stores client keys by ID
pub struct KeyStore {
    client_keys: RwLock<HashMap<String, ClientKey>>,
    server_key: ServerKey,
    keys_dir: Option<PathBuf>,
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
            client_keys: self.client_keys.read().unwrap().clone(),
            server_key: self.server_key.clone(),
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
                set_server_key(persisted.server_key.clone());
                return Self {
                    client_keys: RwLock::new(persisted.client_keys),
                    server_key: persisted.server_key,
                    keys_dir: Some(keys_dir.clone()),
                };
            }
            warn!(
                "No persisted TFHE keys found at {}; generating new keys",
                Self::keystore_path(keys_dir).display()
            );
        }

        let config = ConfigBuilder::default().build();
        let (client_key, server_key) = generate_keys(config);

        // Set server key globally for FHE operations
        set_server_key(server_key.clone());

        let mut client_keys = HashMap::new();
        let default_key_id = "default".to_string();
        client_keys.insert(default_key_id, client_key);

        let store = Self {
            client_keys: RwLock::new(client_keys),
            server_key,
            keys_dir,
        };

        store.try_persist_to_disk();

        store
    }

    /// Generate a new client key and return its ID
    pub fn generate_client_key(&self) -> String {
        let config = ConfigBuilder::default().build();
        let (client_key, _) = generate_keys(config);

        let key_id = Uuid::new_v4().to_string();
        self.client_keys
            .write()
            .unwrap()
            .insert(key_id.clone(), client_key);

        self.try_persist_to_disk();

        key_id
    }

    /// Get a client key by ID
    pub fn get_client_key(&self, key_id: &str) -> Option<ClientKey> {
        self.client_keys.read().unwrap().get(key_id).cloned()
    }

    /// Get the server key
    pub fn get_server_key(&self) -> &ServerKey {
        &self.server_key
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

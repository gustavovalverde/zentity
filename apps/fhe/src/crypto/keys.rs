//! FHE Key Management
//!
//! Handles generation, storage, and retrieval of FHE keys.

use once_cell::sync::OnceCell;
use std::collections::HashMap;
use std::sync::RwLock;
use tfhe::prelude::*;
use tfhe::{generate_keys, set_server_key, ClientKey, ConfigBuilder, ServerKey};
use uuid::Uuid;

/// Global key storage
static KEYS: OnceCell<KeyStore> = OnceCell::new();

/// Stores client keys by ID
pub struct KeyStore {
    client_keys: RwLock<HashMap<String, ClientKey>>,
    server_key: ServerKey,
}

impl KeyStore {
    fn new() -> Self {
        let config = ConfigBuilder::default().build();
        let (client_key, server_key) = generate_keys(config);

        // Set server key globally for FHE operations
        set_server_key(server_key.clone());

        let mut client_keys = HashMap::new();
        let default_key_id = "default".to_string();
        client_keys.insert(default_key_id, client_key);

        Self {
            client_keys: RwLock::new(client_keys),
            server_key,
        }
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
    KEYS.get().expect("Keys not initialized. Call init_keys() first.")
}

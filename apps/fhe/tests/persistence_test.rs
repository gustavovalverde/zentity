//! Key persistence tests for FHE service.
//!
//! Tests disk persistence of the key store using isolated KeyStore instances.
//! These tests use the test-support keystore helpers to create independent KeyStore
//! instances, avoiding the global OnceCell initialization issue.

use fhe_service::test_support::keystore;
use std::fs;
use std::sync::OnceLock;
use tempfile::TempDir;
use tfhe::{generate_keys, CompressedPublicKey, CompressedServerKey, ConfigBuilder};

/// Cached serialized key bytes - generated once per test session.
static CACHED_KEYPAIR_BYTES: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();

/// Get a test keypair. The keys are generated once and cached as serialized bytes.
/// Each call deserializes a fresh copy to avoid ownership issues.
fn get_test_keypair() -> (CompressedPublicKey, CompressedServerKey) {
    let (public_bytes, server_bytes) = CACHED_KEYPAIR_BYTES.get_or_init(|| {
        let config = ConfigBuilder::default().build();
        let (client_key, _) = generate_keys(config);
        let public_key = CompressedPublicKey::new(&client_key);
        let server_key = CompressedServerKey::new(&client_key);
        let public_bytes = bincode::serialize(&public_key).expect("Failed to serialize public key");
        let server_bytes = bincode::serialize(&server_key).expect("Failed to serialize server key");
        (public_bytes, server_bytes)
    });

    let public_key: CompressedPublicKey =
        bincode::deserialize(public_bytes).expect("Failed to deserialize cached public key");
    let server_key: CompressedServerKey =
        bincode::deserialize(server_bytes).expect("Failed to deserialize cached server key");
    (public_key, server_key)
}

/// Keystore file is created after key registration.
#[test]
fn keystore_file_created_on_registration() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    let key_store = keystore::create_test_keystore(keys_dir.clone());
    let (public_key, server_key) = get_test_keypair();
    let _key_id = key_store
        .register_key(public_key, server_key)
        .expect("Failed to register test keys");

    let keystore_path = keystore::get_keystore_path(&keys_dir);
    assert!(
        keystore_path.exists(),
        "Keystore file should be created at {}",
        keystore_path.display()
    );

    let file_size = fs::metadata(&keystore_path).unwrap().len();
    assert!(file_size > 0, "Keystore file should not be empty");
}

/// Keystore file is valid and can be reloaded.
#[test]
fn keystore_file_can_be_reloaded() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    let key_store = keystore::create_test_keystore(keys_dir.clone());
    let (public_key, server_key) = get_test_keypair();
    let key_id = key_store
        .register_key(public_key, server_key)
        .expect("Failed to register test keys");

    assert!(
        key_store.get_server_key(&key_id).is_some(),
        "Key should exist in original store"
    );

    let reloaded_store = keystore::create_test_keystore_with_load(keys_dir);
    assert!(
        reloaded_store.get_server_key(&key_id).is_some(),
        "Key should be reloaded from disk"
    );
}

/// Multiple keys are persisted correctly.
#[test]
fn multiple_keys_persisted() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    let key_store = keystore::create_test_keystore(keys_dir.clone());

    let mut key_ids = Vec::new();
    for _ in 0..3 {
        let (public_key, server_key) = get_test_keypair();
        let key_id = key_store
            .register_key(public_key, server_key)
            .expect("Failed to register test keys");
        key_ids.push(key_id);
    }

    for key_id in &key_ids {
        assert!(
            key_store.get_server_key(key_id).is_some(),
            "Key {} should be retrievable",
            key_id
        );
    }

    let reloaded_store = keystore::create_test_keystore_with_load(keys_dir);
    for key_id in &key_ids {
        assert!(
            reloaded_store.get_server_key(key_id).is_some(),
            "Key {} should be reloaded from disk",
            key_id
        );
    }
}

/// Non-existent key returns None.
#[test]
fn get_nonexistent_key_returns_none() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();
    let key_store = keystore::create_test_keystore(keys_dir);

    let retrieved = key_store.get_server_key("nonexistent-key-id");
    assert!(retrieved.is_none());
}

/// Key IDs are unique UUIDs.
#[test]
fn key_ids_are_unique() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();
    let key_store = keystore::create_test_keystore(keys_dir);

    let mut key_ids = Vec::new();
    for _ in 0..5 {
        let (public_key, server_key) = get_test_keypair();
        let key_id = key_store
            .register_key(public_key, server_key)
            .expect("Failed to register test keys");
        key_ids.push(key_id);
    }

    let unique_count = key_ids
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len();
    assert_eq!(unique_count, key_ids.len(), "All key IDs should be unique");

    for key_id in &key_ids {
        assert!(
            uuid::Uuid::parse_str(key_id).is_ok(),
            "Key ID should be a valid UUID: {}",
            key_id
        );
    }
}

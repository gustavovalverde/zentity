//! Key persistence tests for FHE service.
//!
//! Tests disk persistence of the key store using isolated KeyStore instances.
//! These tests use the test-support keystore helpers to create independent KeyStore
//! instances, avoiding the global OnceCell initialization issue.
//!
//! # Performance
//! TFHE key generation is extremely slow (~10s) and keys are large (~100MB).
//! We cache a single serialized key and deserialize it for each test to avoid
//! repeated key generation and stack overflow issues.

use fhe_service::test_support::keystore;
use std::fs;
use std::sync::OnceLock;
use tempfile::TempDir;
use tfhe::{generate_keys, CompressedPublicKey, CompressedServerKey, ConfigBuilder, ServerKey};

const KEYSTORE_FILE_NAME: &str = "keystore.bincode";

/// Cached serialized server key bytes - generated once per test session.
static CACHED_KEYPAIR_BYTES: OnceLock<(Vec<u8>, Vec<u8>)> = OnceLock::new();

/// Get a test keypair. The keys are generated once and cached as serialized bytes.
/// Each call deserializes a fresh copy to avoid ownership issues.
fn get_test_keypair() -> (CompressedPublicKey, ServerKey) {
    let (public_bytes, server_bytes) = CACHED_KEYPAIR_BYTES.get_or_init(|| {
        let config = ConfigBuilder::default().build();
        let (client_key, _) = generate_keys(config);
        let compressed = CompressedServerKey::new(&client_key);
        let public_key = CompressedPublicKey::new(&client_key);
        let public_bytes = bincode::serialize(&public_key).expect("Failed to serialize public key");
        let server_bytes = bincode::serialize(&compressed).expect("Failed to serialize server key");
        (public_bytes, server_bytes)
    });

    let public_key: CompressedPublicKey =
        bincode::deserialize(public_bytes).expect("Failed to deserialize cached public key");
    let compressed: CompressedServerKey =
        bincode::deserialize(server_bytes).expect("Failed to deserialize cached server key");
    (public_key, compressed.decompress())
}

// ============================================================================
// Keystore File Creation Tests
// ============================================================================

/// Keystore file is created after key registration.
#[test]
fn keystore_file_created_on_registration() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    // Create isolated keystore with persistence
    let key_store = keystore::create_test_keystore(Some(keys_dir.clone()));

    // Register a key
    let (public_key, server_key) = get_test_keypair();
    let _key_id = key_store.register_key(public_key, server_key);

    // Verify file exists
    let keystore_path = keystore::get_keystore_path(&keys_dir);
    assert!(
        keystore_path.exists(),
        "Keystore file should be created at {}",
        keystore_path.display()
    );

    // Verify file is not empty
    let file_size = fs::metadata(&keystore_path).unwrap().len();
    assert!(file_size > 0, "Keystore file should not be empty");
}

/// Keystore file is valid and can be reloaded.
#[test]
fn keystore_file_can_be_reloaded() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    // Create keystore and register a key
    let key_store = keystore::create_test_keystore(Some(keys_dir.clone()));
    let (public_key, server_key) = get_test_keypair();
    let key_id = key_store.register_key(public_key, server_key);

    // Verify key exists in original store
    assert!(
        key_store.get_server_key(&key_id).is_some(),
        "Key should exist in original store"
    );

    // Create new keystore that loads from disk
    let reloaded_store = keystore::create_test_keystore_with_load(keys_dir);

    // Verify key was reloaded
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

    let key_store = keystore::create_test_keystore(Some(keys_dir.clone()));

    // Register multiple keys
    let mut key_ids = Vec::new();
    for _ in 0..3 {
        let (public_key, server_key) = get_test_keypair();
        let key_id = key_store.register_key(public_key, server_key);
        key_ids.push(key_id);
    }

    // All keys should be retrievable from original store
    for key_id in &key_ids {
        assert!(
            key_store.get_server_key(key_id).is_some(),
            "Key {} should be retrievable",
            key_id
        );
    }

    // Reload and verify all keys present
    let reloaded_store = keystore::create_test_keystore_with_load(keys_dir);
    for key_id in &key_ids {
        assert!(
            reloaded_store.get_server_key(key_id).is_some(),
            "Key {} should be reloaded from disk",
            key_id
        );
    }
}

// ============================================================================
// Atomic Write Tests
// ============================================================================

/// No temporary files left after successful write.
#[test]
fn atomic_write_no_orphan_files() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    let key_store = keystore::create_test_keystore(Some(keys_dir));

    // Register multiple keys
    for _ in 0..3 {
        let (public_key, server_key) = get_test_keypair();
        let _key_id = key_store.register_key(public_key, server_key);
    }

    // List all files in directory
    let files: Vec<_> = fs::read_dir(temp_dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();

    // Should only have keystore.bincode, no .tmp files
    assert!(
        !files.iter().any(|f| f.ends_with(".tmp")),
        "No temporary files should remain: {:?}",
        files
    );
    assert!(
        files.contains(&KEYSTORE_FILE_NAME.to_string()),
        "Keystore file should exist: {:?}",
        files
    );
}

// ============================================================================
// Error Recovery Tests
// ============================================================================

/// Corrupted keystore file is handled gracefully.
#[test]
fn corrupted_keystore_recovery() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    // Write garbage to keystore file
    let keystore_path = keystore::get_keystore_path(&keys_dir);
    fs::write(&keystore_path, b"this is not valid bincode data").unwrap();

    // Create keystore that attempts to load - should fall back to empty
    let key_store = keystore::create_test_keystore_with_load(keys_dir);

    // Should be able to register and retrieve keys
    let (public_key, server_key) = get_test_keypair();
    let key_id = key_store.register_key(public_key, server_key);

    let retrieved = key_store.get_server_key(&key_id);
    assert!(
        retrieved.is_some(),
        "Should be able to register keys after corruption"
    );
}

/// Empty keystore file is handled gracefully.
#[test]
fn empty_keystore_recovery() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    // Write empty file
    let keystore_path = keystore::get_keystore_path(&keys_dir);
    fs::write(&keystore_path, b"").unwrap();

    // Create keystore - should handle gracefully
    let key_store = keystore::create_test_keystore_with_load(keys_dir);

    // Should work as an empty store
    let retrieved = key_store.get_server_key("nonexistent");
    assert!(retrieved.is_none());
}

/// Truncated keystore file is handled gracefully.
#[test]
fn truncated_keystore_recovery() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    // Write partial/truncated bincode
    let keystore_path = keystore::get_keystore_path(&keys_dir);
    fs::write(&keystore_path, &[0x00, 0x01, 0x02, 0x03, 0x04]).unwrap();

    // Create keystore - should handle gracefully
    let key_store = keystore::create_test_keystore_with_load(keys_dir);

    // Should be able to register keys
    let (public_key, server_key) = get_test_keypair();
    let key_id = key_store.register_key(public_key, server_key);

    let retrieved = key_store.get_server_key(&key_id);
    assert!(retrieved.is_some());
}

// ============================================================================
// In-Memory Only Tests
// ============================================================================

/// Keystore without persistence works correctly.
#[test]
fn in_memory_keystore_works() {
    // Create keystore without persistence directory
    let key_store = keystore::create_test_keystore(None);

    // Register and retrieve key
    let (public_key, server_key) = get_test_keypair();
    let key_id = key_store.register_key(public_key, server_key);

    let retrieved = key_store.get_server_key(&key_id);
    assert!(retrieved.is_some(), "Key should be retrievable from memory");
}

/// Non-existent key returns None.
#[test]
fn get_nonexistent_key_returns_none() {
    let key_store = keystore::create_test_keystore(None);

    let retrieved = key_store.get_server_key("nonexistent-key-id");
    assert!(retrieved.is_none());
}

/// Key IDs are unique UUIDs.
#[test]
fn key_ids_are_unique() {
    let key_store = keystore::create_test_keystore(None);

    let mut key_ids = Vec::new();
    for _ in 0..5 {
        let (public_key, server_key) = get_test_keypair();
        let key_id = key_store.register_key(public_key, server_key);
        key_ids.push(key_id);
    }

    // All IDs should be unique
    let unique_count = key_ids
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len();
    assert_eq!(unique_count, key_ids.len(), "All key IDs should be unique");

    // All IDs should be valid UUIDs
    for key_id in &key_ids {
        assert!(
            uuid::Uuid::parse_str(key_id).is_ok(),
            "Key ID should be a valid UUID: {}",
            key_id
        );
    }
}

// ============================================================================
// File Permission Tests (Unix only)
// ============================================================================

/// Keystore file has correct permissions.
#[cfg(unix)]
#[test]
fn keystore_file_permissions() {
    use std::os::unix::fs::PermissionsExt;

    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    let key_store = keystore::create_test_keystore(Some(keys_dir.clone()));
    let (public_key, server_key) = get_test_keypair();
    let _key_id = key_store.register_key(public_key, server_key);

    // Check file permissions
    let keystore_path = keystore::get_keystore_path(&keys_dir);
    let metadata = fs::metadata(&keystore_path).unwrap();
    let permissions = metadata.permissions();

    // Should be readable and writable by owner
    let mode = permissions.mode();
    assert!(mode & 0o400 != 0, "File should be readable by owner");
    assert!(mode & 0o200 != 0, "File should be writable by owner");
}

// ============================================================================
// Helper Utility Tests
// ============================================================================

/// keystore_file_exists utility works correctly.
#[test]
fn keystore_file_exists_utility() {
    let temp_dir = TempDir::new().unwrap();
    let keys_dir = temp_dir.path().to_path_buf();

    // File shouldn't exist initially
    assert!(
        !keystore::keystore_file_exists(&keys_dir),
        "File should not exist initially"
    );

    // Create keystore and register key
    let key_store = keystore::create_test_keystore(Some(keys_dir.clone()));
    let (public_key, server_key) = get_test_keypair();
    let _key_id = key_store.register_key(public_key, server_key);

    // File should exist now
    assert!(
        keystore::keystore_file_exists(&keys_dir),
        "File should exist after registration"
    );
}

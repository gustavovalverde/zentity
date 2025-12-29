//! Shared test utilities for FHE integration tests.
//!
//! # Performance Note
//!
//! TFHE key generation is expensive (~5-10 seconds). This module caches keys
//! using `OnceLock` to generate them only once per test session.
//!
//! **Tips for fast tests:**
//! - Use `get_public_key()` for encryption-only tests (no key registration needed)
//! - Use `get_test_keys()` only when you need to verify/decrypt results
//! - The first test that calls these functions will be slow; subsequent tests are fast
//! - Run with `cargo test -- --test-threads=1` to ensure key caching works optimally
#![allow(dead_code)]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::sync::OnceLock;
use tfhe::{generate_keys, ClientKey, CompressedPublicKey, CompressedServerKey, ConfigBuilder};

/// Test key material cached for reuse across tests.
/// This avoids regenerating expensive TFHE keys for each test.
struct TestKeyMaterial {
    /// Serialized client key for decryption
    client_key_bytes: Vec<u8>,
    /// Base64-encoded public key for encryption
    public_key_b64: String,
    /// Serialized compressed server key for registration
    server_key_bytes: Vec<u8>,
}

/// Global cache for test keys - initialized once per test session.
static TEST_KEYS: OnceLock<TestKeyMaterial> = OnceLock::new();

/// Track whether we've registered the cached server key with the global keystore.
static REGISTERED_KEY_ID: OnceLock<String> = OnceLock::new();

/// Initialize TFHE keys for testing.
///
/// Keys are generated once and cached for the entire test session.
/// This significantly speeds up test execution since key generation
/// is the most expensive operation (~5-10 seconds).
fn init_test_keys() -> &'static TestKeyMaterial {
    TEST_KEYS.get_or_init(|| {
        let config = ConfigBuilder::default().build();
        let (client_key, _server_key) = generate_keys(config);
        let public_key = CompressedPublicKey::new(&client_key);
        let server_key = CompressedServerKey::new(&client_key);

        let public_key_b64 = BASE64.encode(bincode::serialize(&public_key).unwrap());
        let client_key_bytes = bincode::serialize(&client_key).unwrap();
        let server_key_bytes = bincode::serialize(&server_key).unwrap();

        TestKeyMaterial {
            client_key_bytes,
            public_key_b64,
            server_key_bytes,
        }
    })
}

/// Get test keys for FHE operations that require verification/decryption.
///
/// Returns:
/// - `ClientKey`: For decrypting results (needed for roundtrip tests)
/// - `String`: Base64-encoded public key for encryption
/// - `String`: Key ID after registering with the global key store
///
/// # Performance
/// First call generates keys (~5-10s), subsequent calls return cached values.
///
/// # Note
/// The server key is registered with the global keystore on first call.
/// The same key_id is returned for all subsequent calls within the test session.
pub fn get_test_keys() -> (ClientKey, String, String) {
    // Initialize the FHE service's key store
    fhe_service::crypto::init_keys();

    let material = init_test_keys();

    // Deserialize client key
    let client_key: ClientKey = bincode::deserialize(&material.client_key_bytes).unwrap();

    // Register server key once and cache the key_id
    let key_id = REGISTERED_KEY_ID
        .get_or_init(|| {
            let server_key: CompressedServerKey =
                bincode::deserialize(&material.server_key_bytes).unwrap();
            fhe_service::crypto::get_key_store().register_server_key(server_key.decompress())
        })
        .clone();

    (client_key, material.public_key_b64.clone(), key_id)
}

/// Get public key only (for encryption tests that don't need decryption).
///
/// This is faster than `get_test_keys()` if you only need to test encryption,
/// as it doesn't register the server key with the global keystore.
///
/// # Performance
/// First call generates keys (~5-10s), subsequent calls return cached value.
pub fn get_public_key() -> String {
    let material = init_test_keys();
    material.public_key_b64.clone()
}

/// Get the base64-encoded server key for registration tests.
///
/// This returns the raw server key bytes, which can be used to test
/// the key registration endpoint directly.
pub fn get_server_key_b64() -> String {
    let material = init_test_keys();
    BASE64.encode(&material.server_key_bytes)
}

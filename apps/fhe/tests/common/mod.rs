//! Shared test utilities for FHE integration tests.
//!
//! Provides key generation and setup helpers that are cached across tests
//! for performance (TFHE key generation is expensive).

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::sync::OnceLock;
use tfhe::{generate_keys, ClientKey, CompressedPublicKey, CompressedServerKey, ConfigBuilder};

/// Test key material cached for reuse across tests.
struct TestKeyMaterial {
    client_key_bytes: Vec<u8>,
    public_key_b64: String,
    server_key_bytes: Vec<u8>,
}

static TEST_KEYS: OnceLock<TestKeyMaterial> = OnceLock::new();

/// Initialize TFHE keys for testing.
///
/// Keys are generated once and cached for the entire test session.
/// This significantly speeds up test execution since key generation
/// is the most expensive operation.
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

/// Get test keys for FHE operations.
///
/// Returns:
/// - ClientKey: For decrypting results
/// - String: Base64-encoded public key for encryption
/// - String: Key ID after registering with the key store
pub fn get_test_keys() -> (ClientKey, String, String) {
    // Initialize the FHE service's key store
    fhe_service::crypto::init_keys();

    let material = init_test_keys();

    // Deserialize keys for this test
    let client_key: ClientKey = bincode::deserialize(&material.client_key_bytes).unwrap();
    let server_key: CompressedServerKey = bincode::deserialize(&material.server_key_bytes).unwrap();

    // Register server key and get ID
    let key_id = fhe_service::crypto::get_key_store().register_server_key(server_key.decompress());

    (client_key, material.public_key_b64.clone(), key_id)
}

/// Get public key only (for encryption tests that don't need decryption).
pub fn get_public_key() -> String {
    let material = init_test_keys();
    material.public_key_b64.clone()
}

/// Get client key only (for decryption).
pub fn get_client_key() -> ClientKey {
    let material = init_test_keys();
    bincode::deserialize(&material.client_key_bytes).unwrap()
}

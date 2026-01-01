//! Key Management Integration Tests
//!
//! Tests FHE key encoding, decoding, registration, and retrieval.

mod common;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use fhe_service::crypto::{
    decode_compressed_public_key, decode_compressed_server_key, decode_server_key, get_key_store,
    init_keys, setup_for_verification,
};
use tfhe::{generate_keys, CompressedPublicKey, CompressedServerKey, ConfigBuilder};

// ===================
// Key Decoding Tests
// ===================

#[test]
fn decode_compressed_public_key_valid() {
    // Generate a real key pair
    let config = ConfigBuilder::default().build();
    let (client_key, _) = generate_keys(config);
    let public_key = CompressedPublicKey::new(&client_key);

    // Encode it
    let encoded = BASE64.encode(bincode::serialize(&public_key).unwrap());

    // Decode it back
    let result = decode_compressed_public_key(&encoded);

    assert!(result.is_ok(), "Should decode valid public key");
}

#[test]
fn decode_compressed_public_key_invalid_base64() {
    let result = decode_compressed_public_key("not valid base64!!!");

    assert!(result.is_err());
}

#[test]
fn decode_compressed_public_key_invalid_content() {
    // Valid base64 but not a valid public key
    let invalid = BASE64.encode(b"this is not a public key");

    let result = decode_compressed_public_key(&invalid);

    assert!(result.is_err());
}

#[test]
fn decode_compressed_public_key_empty() {
    let empty = BASE64.encode(b"");

    let result = decode_compressed_public_key(&empty);

    assert!(result.is_err());
}

#[test]
fn decode_compressed_server_key_valid() {
    // Generate a real key pair
    let config = ConfigBuilder::default().build();
    let (client_key, _) = generate_keys(config);
    let server_key = CompressedServerKey::new(&client_key);

    // Encode it
    let encoded = BASE64.encode(bincode::serialize(&server_key).unwrap());

    // Decode it back
    let result = decode_compressed_server_key(&encoded);

    assert!(result.is_ok(), "Should decode valid server key");
}

#[test]
fn decode_compressed_server_key_invalid_base64() {
    let result = decode_compressed_server_key("not valid base64!!!");

    assert!(result.is_err());
}

#[test]
fn decode_server_key_decompresses() {
    // Generate a real key pair
    let config = ConfigBuilder::default().build();
    let (client_key, _) = generate_keys(config);
    let server_key = CompressedServerKey::new(&client_key);

    // Encode it
    let encoded = BASE64.encode(bincode::serialize(&server_key).unwrap());

    // Decode and decompress
    let result = decode_server_key(&encoded);

    assert!(
        result.is_ok(),
        "Should decode and decompress valid server key"
    );
}

// ===================
// Key Store Tests
// ===================

#[test]
fn key_store_register_and_retrieve() {
    init_keys();

    // Generate a keypair
    let config = ConfigBuilder::default().build();
    let (client_key, _) = generate_keys(config);
    let public_key = CompressedPublicKey::new(&client_key);
    let server_key = CompressedServerKey::new(&client_key).decompress();

    // Register it
    let key_store = get_key_store();
    let key_id = key_store.register_key(public_key, server_key);

    // Key ID should be a valid UUID
    assert!(!key_id.is_empty());
    assert!(uuid::Uuid::parse_str(&key_id).is_ok());

    // Should be able to retrieve it
    let retrieved = key_store.get_server_key(&key_id);
    assert!(retrieved.is_some());
}

#[test]
fn key_store_get_nonexistent_key() {
    init_keys();

    let key_store = get_key_store();
    let result = key_store.get_server_key("definitely-not-a-real-key-id");

    assert!(result.is_none());
}

#[test]
fn key_store_unique_key_ids() {
    init_keys();

    // Generate two keypairs
    let config = ConfigBuilder::default().build();
    let (client_key1, _) = generate_keys(config.clone());
    let (client_key2, _) = generate_keys(config);

    let public_key1 = CompressedPublicKey::new(&client_key1);
    let public_key2 = CompressedPublicKey::new(&client_key2);
    let server_key1 = CompressedServerKey::new(&client_key1).decompress();
    let server_key2 = CompressedServerKey::new(&client_key2).decompress();

    // Register both
    let key_store = get_key_store();
    let id1 = key_store.register_key(public_key1, server_key1);
    let id2 = key_store.register_key(public_key2, server_key2);

    // IDs should be unique
    assert_ne!(id1, id2, "Each registration should get unique ID");
}

// ===================
// Setup for Verification Tests
// ===================

#[test]
fn setup_for_verification_with_valid_key() {
    let (_, _, key_id) = common::get_test_keys();

    let result = setup_for_verification(&key_id);

    assert!(result.is_ok());
}

#[test]
fn setup_for_verification_with_invalid_key() {
    init_keys();

    let result = setup_for_verification("nonexistent-key-id");

    assert!(result.is_err());

    let error = result.unwrap_err();
    assert!(
        error.to_string().contains("not found")
            || error.to_string().contains("KeyNotFound")
            || error.to_string().contains("nonexistent-key-id"),
        "Error should indicate key not found: {}",
        error
    );
}

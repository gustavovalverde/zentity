//! Age Verification Integration Tests
//!
//! Tests FHE-based birth year offset encryption and age verification operations.

mod common;
use fhe_service::crypto::{encrypt_birth_year_offset, verify_age_offset};
use tfhe::prelude::FheDecrypt;
use tfhe::FheBool;

#[test]
fn encrypt_and_verify_age_adult() {
    let (client_key, public_key, key_id) = common::get_test_keys();

    // Person born in 2000 is 25 in 2025
    let offset = 2000u16 - 1900;
    let ciphertext = encrypt_birth_year_offset(offset, &public_key).unwrap();
    let result_ciphertext = verify_age_offset(&ciphertext, 2025, 18, &key_id).unwrap();

    let encrypted: FheBool = bincode::deserialize(&result_ciphertext).unwrap();
    let is_adult = encrypted.decrypt(&client_key);

    assert!(is_adult, "Person born in 2000 should be adult in 2025");
}

#[test]
fn encrypt_and_verify_age_underage() {
    let (client_key, public_key, key_id) = common::get_test_keys();

    // Person born in 2010 is 15 in 2025
    let offset = 2010u16 - 1900;
    let ciphertext = encrypt_birth_year_offset(offset, &public_key).unwrap();
    let result_ciphertext = verify_age_offset(&ciphertext, 2025, 18, &key_id).unwrap();

    let encrypted: FheBool = bincode::deserialize(&result_ciphertext).unwrap();
    let is_adult = encrypted.decrypt(&client_key);

    assert!(!is_adult, "Person born in 2010 should NOT be adult in 2025");
}

#[test]
fn encrypt_and_verify_age_exactly_18() {
    let (client_key, public_key, key_id) = common::get_test_keys();

    // Person born in 2007 is exactly 18 in 2025
    let offset = 2007u16 - 1900;
    let ciphertext = encrypt_birth_year_offset(offset, &public_key).unwrap();
    let result_ciphertext = verify_age_offset(&ciphertext, 2025, 18, &key_id).unwrap();

    let encrypted: FheBool = bincode::deserialize(&result_ciphertext).unwrap();
    let is_adult = encrypted.decrypt(&client_key);

    assert!(is_adult, "Person born in 2007 should be exactly 18 in 2025");
}

#[test]
fn encrypt_and_verify_age_just_under_18() {
    let (client_key, public_key, key_id) = common::get_test_keys();

    // Person born in 2008 is only 17 in 2025
    let offset = 2008u16 - 1900;
    let ciphertext = encrypt_birth_year_offset(offset, &public_key).unwrap();
    let result_ciphertext = verify_age_offset(&ciphertext, 2025, 18, &key_id).unwrap();

    let encrypted: FheBool = bincode::deserialize(&result_ciphertext).unwrap();
    let is_adult = encrypted.decrypt(&client_key);

    assert!(
        !is_adult,
        "Person born in 2008 should NOT be 18 yet in 2025"
    );
}

#[test]
fn encrypt_and_verify_age_different_min_ages() {
    let (client_key, public_key, key_id) = common::get_test_keys();

    // Person born in 2004 is 21 in 2025
    let offset = 2004u16 - 1900;
    let ciphertext = encrypt_birth_year_offset(offset, &public_key).unwrap();

    // Should pass age 18 check
    let result_18 = verify_age_offset(&ciphertext, 2025, 18, &key_id).unwrap();
    let encrypted: FheBool = bincode::deserialize(&result_18).unwrap();
    assert!(encrypted.decrypt(&client_key), "Should be >= 18");

    // Should pass age 21 check
    let result_21 = verify_age_offset(&ciphertext, 2025, 21, &key_id).unwrap();
    let encrypted: FheBool = bincode::deserialize(&result_21).unwrap();
    assert!(encrypted.decrypt(&client_key), "Should be >= 21");

    // Should fail age 25 check
    let result_25 = verify_age_offset(&ciphertext, 2025, 25, &key_id).unwrap();
    let encrypted: FheBool = bincode::deserialize(&result_25).unwrap();
    assert!(!encrypted.decrypt(&client_key), "Should NOT be >= 25");
}

#[test]
fn encrypt_birth_year_offset_produces_valid_ciphertext() {
    let public_key = common::get_public_key();
    let offset = 1990u16 - 1900;
    let ciphertext = encrypt_birth_year_offset(offset, &public_key).unwrap();

    // Should be non-empty bytes
    assert!(!ciphertext.is_empty());
}

#[test]
fn verify_age_with_invalid_key_id_fails() {
    // Must initialize key store before verification (even with invalid key)
    fhe_service::test_support::init_test_env();
    fhe_service::crypto::init_keys().expect("Failed to initialize FHE keys for tests");

    let public_key = common::get_public_key();

    let offset = 2000u16 - 1900;
    let ciphertext = encrypt_birth_year_offset(offset, &public_key).unwrap();

    // Use a fake key ID
    let result = verify_age_offset(&ciphertext, 2025, 18, "non-existent-key-id");

    assert!(result.is_err(), "Should fail with invalid key ID");
    let error = result.unwrap_err();
    assert!(
        error.to_string().contains("not found") || error.to_string().contains("KeyNotFound"),
        "Error should indicate key not found: {}",
        error
    );
}

#[test]
fn verify_age_with_invalid_ciphertext_fails() {
    let (_, _, key_id) = common::get_test_keys();

    let invalid_ciphertext = b"not a valid ciphertext".to_vec();

    let result = verify_age_offset(&invalid_ciphertext, 2025, 18, &key_id);

    assert!(result.is_err(), "Should fail with invalid ciphertext");
}

#[test]
fn decode_invalid_public_key_fails() {
    let invalid_public_key = b"not a valid public key";
    let result = fhe_service::crypto::decode_compressed_public_key(invalid_public_key);

    assert!(result.is_err(), "Should fail with invalid public key");
}

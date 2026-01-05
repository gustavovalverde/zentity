//! Compliance Level Encryption Integration Tests

mod common;
use fhe_service::crypto::encrypt_compliance_level;

#[test]
fn encrypt_compliance_level_produces_valid_ciphertext() {
    let public_key = common::get_public_key();
    let ciphertext = encrypt_compliance_level(3, &public_key).unwrap();

    assert!(!ciphertext.is_empty());
}

#[test]
fn encrypt_compliance_level_rejects_invalid_value() {
    let public_key = common::get_public_key();
    let err = encrypt_compliance_level(99, &public_key).unwrap_err();
    assert!(err.to_string().contains("Compliance level"));
}

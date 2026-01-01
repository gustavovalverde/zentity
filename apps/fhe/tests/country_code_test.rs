//! Country Code Encryption Integration Tests

mod common;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use fhe_service::crypto::encrypt_country_code;

#[test]
fn encrypt_country_code_produces_valid_ciphertext() {
    let public_key = common::get_public_key();
    let ciphertext = encrypt_country_code(840, &public_key).unwrap();

    assert!(BASE64.decode(&ciphertext).is_ok());
    assert!(!ciphertext.is_empty());
}

#[test]
fn encrypt_country_code_rejects_invalid_value() {
    let public_key = common::get_public_key();
    let err = encrypt_country_code(1200, &public_key).unwrap_err();
    assert!(err.to_string().contains("Country code"));
}

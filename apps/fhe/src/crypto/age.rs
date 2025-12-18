//! Age Verification Operations
//!
//! Provides FHE-based age verification operations.

use super::{get_key_store, setup_for_verification};
use crate::error::FheError;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tfhe::prelude::*;
use tfhe::FheUint16;

/// Encrypt a birth year using the specified client key
pub fn encrypt_birth_year(birth_year: u16, client_key_id: &str) -> Result<String, FheError> {
    let key_store = get_key_store();

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    let encrypted = FheUint16::encrypt(birth_year, &client_key);

    // Serialize to bytes using bincode 2.x serde API
    let bytes = bincode::serde::encode_to_vec(&encrypted, bincode::config::standard())?;

    // Encode as base64
    Ok(BASE64.encode(&bytes))
}

/// Verify age on encrypted data
pub fn verify_age(
    ciphertext_b64: &str,
    current_year: u16,
    min_age: u16,
    client_key_id: &str,
) -> Result<bool, FheError> {
    let client_key = setup_for_verification(client_key_id)?;

    // Decode base64
    let bytes = BASE64.decode(ciphertext_b64)?;

    // Deserialize to FheUint16 using bincode 2.x serde API
    let (encrypted_birth_year, _): (FheUint16, _) =
        bincode::serde::decode_from_slice(&bytes, bincode::config::standard())?;

    // Compute age homomorphically: current_year - birth_year
    let encrypted_age = current_year - &encrypted_birth_year;

    // Check if age >= min_age
    let encrypted_is_adult = encrypted_age.ge(min_age);

    // Decrypt only the boolean result
    let is_over_18: bool = encrypted_is_adult.decrypt(&client_key);

    Ok(is_over_18)
}

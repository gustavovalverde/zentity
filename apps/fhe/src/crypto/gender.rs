//! Gender Encryption Operations
//!
//! Provides FHE-based gender encryption using ISO/IEC 5218 encoding:
//! - 0 = Not known
//! - 1 = Male
//! - 2 = Female
//! - 9 = Not applicable

use super::{get_key_store, setup_for_verification};
use crate::error::FheError;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tfhe::prelude::*;
use tfhe::FheUint8;

/// ISO/IEC 5218 gender codes
#[derive(Debug, Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum Gender {
    NotKnown = 0,
    Male = 1,
    Female = 2,
    NotApplicable = 9,
}

impl Gender {
    /// Parse gender from ISO 5218 code
    pub fn from_code(code: u8) -> Result<Self, FheError> {
        match code {
            0 => Ok(Gender::NotKnown),
            1 => Ok(Gender::Male),
            2 => Ok(Gender::Female),
            9 => Ok(Gender::NotApplicable),
            _ => Err(FheError::InvalidInput(format!(
                "Invalid ISO 5218 gender code: {}. Valid codes are 0, 1, 2, 9",
                code
            ))),
        }
    }

    /// Convert to u8 code
    #[allow(dead_code)]
    pub fn to_code(self) -> u8 {
        self as u8
    }
}

/// Encrypt a gender code using the specified client key
pub fn encrypt_gender(gender_code: u8, client_key_id: &str) -> Result<String, FheError> {
    // Validate ISO 5218 code
    let _ = Gender::from_code(gender_code)?;

    let key_store = get_key_store();

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    let encrypted = FheUint8::encrypt(gender_code, &client_key);

    // Serialize to bytes using bincode 2.x serde API
    let bytes = bincode::serde::encode_to_vec(&encrypted, bincode::config::standard())?;

    // Encode as base64
    Ok(BASE64.encode(&bytes))
}

/// Verify if encrypted gender matches a claimed gender
pub fn verify_gender_match(
    ciphertext_b64: &str,
    claimed_gender: u8,
    client_key_id: &str,
) -> Result<bool, FheError> {
    // Validate claimed gender
    let _ = Gender::from_code(claimed_gender)?;

    let client_key = setup_for_verification(client_key_id)?;

    // Decode base64
    let bytes = BASE64.decode(ciphertext_b64)?;

    // Deserialize to FheUint8 using bincode 2.x serde API
    let (encrypted_gender, _): (FheUint8, _) =
        bincode::serde::decode_from_slice(&bytes, bincode::config::standard())?;

    // Check if gender matches claimed value (homomorphic equality)
    let encrypted_matches = encrypted_gender.eq(claimed_gender);

    // Decrypt only the boolean result
    let matches: bool = encrypted_matches.decrypt(&client_key);

    Ok(matches)
}

//! Age Verification Operations (Birth Year Offset)
//!
//! Provides FHE-based age verification operations using a birth year offset
//! (years since 1900). This avoids storing full DOB while still supporting
//! age threshold checks.

use super::{
    decode_bincode_base64, decode_compressed_public_key, encode_bincode_base64,
    setup_for_verification,
};
use crate::error::FheError;
use tfhe::prelude::*;
use tfhe::FheUint16;

const BASE_YEAR: u16 = 1900;
const MAX_OFFSET: u16 = 255;

fn validate_offset(offset: u16) -> Result<(), FheError> {
    if offset > MAX_OFFSET {
        return Err(FheError::InvalidInput(format!(
            "Birth year offset must be 0-{} (got {})",
            MAX_OFFSET, offset
        )));
    }
    Ok(())
}

/// Encrypt a birth year offset (years since 1900) using the provided public key
pub fn encrypt_birth_year_offset(
    birth_year_offset: u16,
    public_key_b64: &str,
) -> Result<String, FheError> {
    validate_offset(birth_year_offset)?;

    let public_key = decode_compressed_public_key(public_key_b64)?;
    let encrypted = FheUint16::try_encrypt(birth_year_offset, &public_key)
        .map_err(|error| FheError::Tfhe(error.to_string()))?;

    // Serialize to bytes using bincode
    encode_bincode_base64(&encrypted)
}

/// Verify age on encrypted birth year offset.
///
/// Returns an encrypted boolean (base64) that must be decrypted by the client.
pub fn verify_age_offset(
    ciphertext_b64: &str,
    current_year: u16,
    min_age: u16,
    key_id: &str,
) -> Result<String, FheError> {
    if current_year < BASE_YEAR {
        return Err(FheError::InvalidInput(format!(
            "Current year must be >= {} (got {})",
            BASE_YEAR, current_year
        )));
    }

    let current_offset = current_year - BASE_YEAR;
    if min_age > current_offset {
        return Err(FheError::InvalidInput(format!(
            "Min age {} is too large for current year {}",
            min_age, current_year
        )));
    }

    setup_for_verification(key_id)?;

    let encrypted_birth_year_offset: FheUint16 = decode_bincode_base64(ciphertext_b64)?;

    // Compute max allowed offset for the min age (older => smaller offset)
    let min_offset = current_offset - min_age;

    // Check if offset <= min_offset (born on or before cutoff)
    let encrypted_is_adult = encrypted_birth_year_offset.le(min_offset);

    // Serialize encrypted boolean result (client will decrypt)
    encode_bincode_base64(&encrypted_is_adult)
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::get_test_keys;
    use super::*;
    use tfhe::FheBool;

    #[test]
    fn encrypt_and_verify_age_roundtrip() {
        let (client_key, public_key_b64, key_id) = get_test_keys();
        let offset = 2000u16 - BASE_YEAR;
        let ciphertext = encrypt_birth_year_offset(offset, &public_key_b64).unwrap();
        let result_ciphertext = verify_age_offset(&ciphertext, 2025, 18, &key_id).unwrap();

        let encrypted: FheBool = decode_bincode_base64(&result_ciphertext).unwrap();
        let is_adult = encrypted.decrypt(&client_key);

        assert!(is_adult);
    }
}

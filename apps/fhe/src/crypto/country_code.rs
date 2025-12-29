//! Country Code Encryption Operations
//!
//! Provides FHE-based encryption for ISO numeric country codes.

use super::decode_compressed_public_key;
use crate::error::FheError;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tfhe::prelude::*;
use tfhe::FheUint16;

const MAX_COUNTRY_CODE: u16 = 999;

/// Encrypt a numeric country code using the provided public key.
///
/// Accepts ISO 3166-1 numeric codes (0-999).
pub fn encrypt_country_code(country_code: u16, public_key_b64: &str) -> Result<String, FheError> {
    if country_code > MAX_COUNTRY_CODE {
        return Err(FheError::InvalidInput(format!(
            "Country code must be 0-{} (got {})",
            MAX_COUNTRY_CODE, country_code
        )));
    }

    let public_key = decode_compressed_public_key(public_key_b64)?;
    let encrypted = FheUint16::try_encrypt(country_code, &public_key)
        .map_err(|error| FheError::Tfhe(error.to_string()))?;

    let bytes = bincode::serialize(&encrypted)?;
    Ok(BASE64.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::test_helpers::get_test_keys;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    #[test]
    fn encrypt_country_code_roundtrip_base64() {
        let (_client_key, public_key_b64, _key_id) = get_test_keys();
        let ciphertext = encrypt_country_code(840, &public_key_b64).unwrap();
        assert!(BASE64.decode(ciphertext).is_ok());
    }

    #[test]
    fn encrypt_country_code_rejects_out_of_range() {
        let (_client_key, public_key_b64, _key_id) = get_test_keys();
        let err = encrypt_country_code(1200, &public_key_b64).unwrap_err();
        assert!(err.to_string().contains("Country code"));
    }
}

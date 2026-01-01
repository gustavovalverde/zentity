//! Country Code Encryption Operations
//!
//! Provides FHE-based encryption for ISO numeric country codes.

use super::encode_bincode_base64;
use crate::error::FheError;
use tfhe::prelude::*;
use tfhe::{CompressedPublicKey, FheUint16};

const MAX_COUNTRY_CODE: u16 = 999;

/// Encrypt a numeric country code using the provided public key.
///
/// Accepts ISO 3166-1 numeric codes (0-999).
pub fn encrypt_country_code(
    country_code: u16,
    public_key: &CompressedPublicKey,
) -> Result<String, FheError> {
    if country_code > MAX_COUNTRY_CODE {
        return Err(FheError::InvalidInput(format!(
            "Country code must be 0-{} (got {})",
            MAX_COUNTRY_CODE, country_code
        )));
    }

    let encrypted = FheUint16::try_encrypt(country_code, public_key)
        .map_err(|error| FheError::Tfhe(error.to_string()))?;

    encode_bincode_base64(&encrypted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::decode_bincode_base64;
    use crate::crypto::test_helpers::get_test_keys;

    #[test]
    fn encrypt_country_code_roundtrip_base64() {
        let (_client_key, public_key, _key_id) = get_test_keys();
        let ciphertext = encrypt_country_code(840, &public_key).unwrap();
        let decoded: Result<FheUint16, _> = decode_bincode_base64(&ciphertext);
        assert!(decoded.is_ok());
    }

    #[test]
    fn encrypt_country_code_rejects_out_of_range() {
        let (_client_key, public_key, _key_id) = get_test_keys();
        let err = encrypt_country_code(1200, &public_key).unwrap_err();
        assert!(err.to_string().contains("Country code"));
    }
}

//! Compliance Level Encryption Operations
//!
//! Provides FHE-based encryption for compliance level values.

use super::encode_bincode_base64;
use crate::error::FheError;
use tfhe::prelude::*;
use tfhe::{CompressedPublicKey, FheUint8};

const MAX_COMPLIANCE_LEVEL: u8 = 10;

/// Encrypt a compliance level using the provided public key.
///
/// Levels are expected to be small integers (0-10).
pub fn encrypt_compliance_level(
    compliance_level: u8,
    public_key: &CompressedPublicKey,
) -> Result<String, FheError> {
    if compliance_level > MAX_COMPLIANCE_LEVEL {
        return Err(FheError::InvalidInput(format!(
            "Compliance level must be 0-{} (got {})",
            MAX_COMPLIANCE_LEVEL, compliance_level
        )));
    }

    let encrypted = FheUint8::try_encrypt(compliance_level, public_key)
        .map_err(|error| FheError::Tfhe(error.to_string()))?;

    encode_bincode_base64(&encrypted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::decode_bincode_base64;
    use crate::crypto::test_helpers::get_test_keys;

    #[test]
    fn encrypt_compliance_level_roundtrip_base64() {
        let (_client_key, public_key, _key_id) = get_test_keys();
        let ciphertext = encrypt_compliance_level(3, &public_key).unwrap();
        let decoded: Result<FheUint8, _> = decode_bincode_base64(&ciphertext);
        assert!(decoded.is_ok());
    }

    #[test]
    fn encrypt_compliance_level_rejects_out_of_range() {
        let (_client_key, public_key, _key_id) = get_test_keys();
        let err = encrypt_compliance_level(99, &public_key).unwrap_err();
        assert!(err.to_string().contains("Compliance level"));
    }
}

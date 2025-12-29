//! Compliance Level Encryption Operations
//!
//! Provides FHE-based encryption for compliance level values.

use super::decode_compressed_public_key;
use crate::error::FheError;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tfhe::prelude::*;
use tfhe::FheUint8;

const MAX_COMPLIANCE_LEVEL: u8 = 10;

/// Encrypt a compliance level using the provided public key.
///
/// Levels are expected to be small integers (0-10).
pub fn encrypt_compliance_level(
    compliance_level: u8,
    public_key_b64: &str,
) -> Result<String, FheError> {
    if compliance_level > MAX_COMPLIANCE_LEVEL {
        return Err(FheError::InvalidInput(format!(
            "Compliance level must be 0-{} (got {})",
            MAX_COMPLIANCE_LEVEL, compliance_level
        )));
    }

    let public_key = decode_compressed_public_key(public_key_b64)?;
    let encrypted = FheUint8::try_encrypt(compliance_level, &public_key)
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
    fn encrypt_compliance_level_roundtrip_base64() {
        let (_client_key, public_key_b64, _key_id) = get_test_keys();
        let ciphertext = encrypt_compliance_level(3, &public_key_b64).unwrap();
        assert!(BASE64.decode(ciphertext).is_ok());
    }

    #[test]
    fn encrypt_compliance_level_rejects_out_of_range() {
        let (_client_key, public_key_b64, _key_id) = get_test_keys();
        let err = encrypt_compliance_level(99, &public_key_b64).unwrap_err();
        assert!(err.to_string().contains("Compliance level"));
    }
}

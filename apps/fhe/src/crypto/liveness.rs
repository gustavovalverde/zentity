//! Liveness Score Encryption Operations
//!
//! Provides FHE-based liveness score encryption and threshold verification.
//! Scores are floats from 0.0 to 1.0, stored as u16 (0-10000) for 4 decimal precision.

use super::{decode_tfhe_binary, encode_tfhe_binary, setup_for_verification};
use crate::error::FheError;
use tfhe::prelude::*;
use tfhe::{CompressedPublicKey, FheUint16};

/// Scale factor for converting float to u16 (4 decimal precision)
const SCORE_SCALE: f64 = 10000.0;

/// Convert a liveness score (0.0-1.0) to scaled u16 (0-10000)
pub fn score_to_u16(score: f64) -> Result<u16, FheError> {
    if !(0.0..=1.0).contains(&score) {
        return Err(FheError::InvalidInput(format!(
            "Liveness score must be between 0.0 and 1.0, got: {}",
            score
        )));
    }
    Ok((score * SCORE_SCALE).round() as u16)
}

/// Convert a threshold (0.0-1.0) to scaled u16 (0-10000)
pub fn threshold_to_u16(threshold: f64) -> Result<u16, FheError> {
    if !(0.0..=1.0).contains(&threshold) {
        return Err(FheError::InvalidInput(format!(
            "Threshold must be between 0.0 and 1.0, got: {}",
            threshold
        )));
    }
    Ok((threshold * SCORE_SCALE).round() as u16)
}

/// Encrypt a liveness score using the provided public key.
///
/// Args:
///   score: Float from 0.0 to 1.0
///   public_key: Compressed public key
///
/// Returns:
///   Binary ciphertext of the score (stored as u16 0-10000)
pub fn encrypt_liveness_score(
    score: f64,
    public_key: &CompressedPublicKey,
) -> Result<Vec<u8>, FheError> {
    let scaled_score = score_to_u16(score)?;
    let encrypted = FheUint16::try_encrypt(scaled_score, public_key)
        .map_err(|error| FheError::Tfhe(error.to_string()))?;

    // Serialize to bytes (tfhe versioned format)
    encode_tfhe_binary(&encrypted)
}

/// Verify if encrypted liveness score meets a threshold.
/// Returns an encrypted boolean (binary) that must be decrypted by the client.
///
/// Performs homomorphic comparison: encrypted_score >= threshold
/// Only reveals whether the threshold was met, not the actual score.
pub fn verify_liveness_threshold(
    ciphertext: &[u8],
    threshold: f64,
    key_id: &str,
) -> Result<Vec<u8>, FheError> {
    let threshold_scaled = threshold_to_u16(threshold)?;
    setup_for_verification(key_id)?;

    let encrypted_score: FheUint16 = decode_tfhe_binary(ciphertext)?;

    // Check if score >= threshold (homomorphic comparison)
    let encrypted_passes = encrypted_score.ge(threshold_scaled);

    encode_tfhe_binary(&encrypted_passes)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===================
    // Score Conversion Tests
    // ===================

    #[test]
    fn test_score_to_u16_valid_values() {
        // Test boundary values
        assert_eq!(score_to_u16(0.0).unwrap(), 0);
        assert_eq!(score_to_u16(1.0).unwrap(), 10000);

        // Test common thresholds
        assert_eq!(score_to_u16(0.3).unwrap(), 3000); // Anti-spoof threshold
        assert_eq!(score_to_u16(0.5).unwrap(), 5000); // Default threshold
        assert_eq!(score_to_u16(0.8).unwrap(), 8000); // High confidence threshold

        // Test precision (4 decimal places)
        assert_eq!(score_to_u16(0.3333).unwrap(), 3333);
        assert_eq!(score_to_u16(0.9999).unwrap(), 9999);
    }

    #[test]
    fn test_score_to_u16_invalid_values() {
        // Test negative values
        assert!(score_to_u16(-0.1).is_err());
        assert!(score_to_u16(-1.0).is_err());

        // Test values above 1.0
        assert!(score_to_u16(1.1).is_err());
        assert!(score_to_u16(1.5).is_err());
        assert!(score_to_u16(10.0).is_err());
    }

    // ===================
    // Threshold Conversion Tests
    // ===================

    #[test]
    fn test_threshold_to_u16_valid_values() {
        assert_eq!(threshold_to_u16(0.0).unwrap(), 0);
        assert_eq!(threshold_to_u16(0.3).unwrap(), 3000); // Common anti-spoof threshold
        assert_eq!(threshold_to_u16(0.5).unwrap(), 5000);
        assert_eq!(threshold_to_u16(1.0).unwrap(), 10000);
    }

    #[test]
    fn test_threshold_to_u16_invalid_values() {
        assert!(threshold_to_u16(-0.1).is_err());
        assert!(threshold_to_u16(1.1).is_err());
    }

    // ===================
    // Constants Tests
    // ===================

    #[test]
    fn test_scale_factor() {
        assert_eq!(SCORE_SCALE, 10000.0);
    }

    // ===================
    // Edge Cases
    // ===================

    #[test]
    fn test_precision_edge_cases() {
        // Very small differences should be preserved
        let score1 = score_to_u16(0.0001).unwrap();
        let score2 = score_to_u16(0.0002).unwrap();
        assert_eq!(score1, 1);
        assert_eq!(score2, 2);
        assert_ne!(score1, score2);
    }

    #[test]
    fn test_rounding_behavior() {
        // Test that rounding works correctly at half-points
        assert_eq!(score_to_u16(0.00005).unwrap(), 1); // Rounds up
        assert_eq!(score_to_u16(0.00004).unwrap(), 0); // Rounds down
    }

    #[test]
    fn test_error_messages() {
        let result = score_to_u16(1.5);
        assert!(result.is_err());
        let error = result.unwrap_err();
        assert!(error.to_string().contains("1.5"));
        assert!(error.to_string().contains("0.0 and 1.0"));
    }

    #[test]
    fn encrypt_and_verify_liveness_roundtrip() {
        use super::super::test_helpers::get_test_keys;
        use tfhe::FheBool;

        let (client_key, public_key, key_id) = get_test_keys();
        let ciphertext = encrypt_liveness_score(0.85, &public_key).unwrap();
        let result_ciphertext = verify_liveness_threshold(&ciphertext, 0.3, &key_id).unwrap();

        let encrypted: FheBool = decode_tfhe_binary(&result_ciphertext).unwrap();
        let passes = encrypted.decrypt(&client_key);

        assert!(passes);
    }
}

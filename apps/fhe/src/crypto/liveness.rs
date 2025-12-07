//! Liveness Score Encryption Operations
//!
//! Provides FHE-based liveness score encryption and threshold verification.
//! Scores are floats from 0.0 to 1.0, stored as u16 (0-10000) for 4 decimal precision.

use super::get_key_store;
use crate::error::FheError;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::time::Instant;
use tfhe::prelude::*;
use tfhe::{set_server_key, FheUint16};

/// Scale factor for converting float to u16 (4 decimal precision)
const SCORE_SCALE: f64 = 10000.0;
#[allow(dead_code)]
const MAX_SCORE_VALUE: u16 = 10000;

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

/// Convert scaled u16 (0-10000) back to float (0.0-1.0)
#[allow(dead_code)]
pub fn u16_to_score(value: u16) -> f64 {
    (value as f64) / SCORE_SCALE
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

/// Encrypt a liveness score using the specified client key
///
/// Args:
///   score: Float from 0.0 to 1.0
///   client_key_id: ID of the client key to use
///
/// Returns:
///   Base64-encoded ciphertext of the score (stored as u16 0-10000)
pub fn encrypt_liveness_score(score: f64, client_key_id: &str) -> Result<String, FheError> {
    let scaled_score = score_to_u16(score)?;

    let key_store = get_key_store();

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    let encrypted = FheUint16::encrypt(scaled_score, &client_key);

    // Serialize to bytes
    let bytes = bincode::serialize(&encrypted)?;

    // Encode as base64
    Ok(BASE64.encode(&bytes))
}

/// Verify if encrypted liveness score meets a threshold
///
/// Performs homomorphic comparison: encrypted_score >= threshold
/// Only reveals whether the threshold was met, not the actual score.
///
/// Args:
///   ciphertext_b64: Base64-encoded encrypted liveness score
///   threshold: Minimum required score (0.0 to 1.0)
///   client_key_id: ID of the client key to use
///
/// Returns:
///   (passes_threshold: bool, elapsed_ms: u64)
pub fn verify_liveness_threshold(
    ciphertext_b64: &str,
    threshold: f64,
    client_key_id: &str,
) -> Result<(bool, u64), FheError> {
    let start = Instant::now();

    let threshold_scaled = threshold_to_u16(threshold)?;

    let key_store = get_key_store();

    // Set server key for this thread
    set_server_key(key_store.get_server_key().clone());

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    // Decode base64
    let bytes = BASE64.decode(ciphertext_b64)?;

    // Deserialize to FheUint16
    let encrypted_score: FheUint16 = bincode::deserialize(&bytes)?;

    // Check if score >= threshold (homomorphic comparison)
    let encrypted_passes = encrypted_score.ge(threshold_scaled);

    // Decrypt only the boolean result
    let passes: bool = encrypted_passes.decrypt(&client_key);

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok((passes, elapsed_ms))
}

/// Decrypt a liveness score ciphertext
///
/// NOTE: This should only be used for debugging or when the full score is needed.
/// For threshold checks, prefer verify_liveness_threshold which reveals less info.
#[allow(dead_code)]
pub fn decrypt_liveness_score(
    ciphertext_b64: &str,
    client_key_id: &str,
) -> Result<(f64, u64), FheError> {
    let start = Instant::now();

    let key_store = get_key_store();

    let client_key = key_store
        .get_client_key(client_key_id)
        .ok_or_else(|| FheError::KeyNotFound(client_key_id.to_string()))?;

    // Decode base64
    let bytes = BASE64.decode(ciphertext_b64)?;

    // Deserialize to FheUint16
    let encrypted_score: FheUint16 = bincode::deserialize(&bytes)?;

    // Decrypt
    let scaled_score: u16 = encrypted_score.decrypt(&client_key);

    let score = u16_to_score(scaled_score);
    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok((score, elapsed_ms))
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

    #[test]
    fn test_u16_to_score() {
        assert_eq!(u16_to_score(0), 0.0);
        assert_eq!(u16_to_score(5000), 0.5);
        assert_eq!(u16_to_score(10000), 1.0);
        assert_eq!(u16_to_score(3000), 0.3);
        assert_eq!(u16_to_score(8500), 0.85);
    }

    #[test]
    fn test_score_roundtrip() {
        // Test multiple values for roundtrip accuracy
        let test_values = [0.0, 0.1, 0.3, 0.5, 0.7654, 0.85, 0.9999, 1.0];

        for &original in &test_values {
            let scaled = score_to_u16(original).unwrap();
            let recovered = u16_to_score(scaled);
            assert!(
                (original - recovered).abs() < 0.0001,
                "Roundtrip failed for {}: got {}",
                original,
                recovered
            );
        }
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
        assert_eq!(MAX_SCORE_VALUE, 10000);
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
}

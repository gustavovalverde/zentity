//! HTTP request/response fixtures for FHE service tests.
//!
//! Provides helper functions to build valid and invalid request bodies
//! for testing various scenarios.
#![allow(dead_code)]

use serde::Serialize;

// ============================================================================
// Key Registration Fixtures
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyRequest {
    #[serde(with = "serde_bytes")]
    pub server_key: Vec<u8>,
    #[serde(with = "serde_bytes")]
    pub public_key: Vec<u8>,
}

/// Build a valid key registration request body.
pub fn register_key_request(server_key: &[u8], public_key: &[u8]) -> RegisterKeyRequest {
    RegisterKeyRequest {
        server_key: server_key.to_vec(),
        public_key: public_key.to_vec(),
    }
}

// ============================================================================
// DOB Days Fixtures
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptDobDaysRequest {
    pub dob_days: u32,
    pub key_id: String,
}

pub fn encrypt_dob_days_request(dob_days: u32, key_id: &str) -> EncryptDobDaysRequest {
    EncryptDobDaysRequest {
        dob_days,
        key_id: key_id.to_string(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeFromDobRequest {
    #[serde(with = "serde_bytes")]
    pub ciphertext: Vec<u8>,
    pub current_days: u32,
    pub min_age: u16,
    pub key_id: String,
}

pub fn verify_age_from_dob_request(
    ciphertext: &[u8],
    current_days: u32,
    min_age: u16,
    key_id: &str,
) -> VerifyAgeFromDobRequest {
    VerifyAgeFromDobRequest {
        ciphertext: ciphertext.to_vec(),
        current_days,
        min_age,
        key_id: key_id.to_string(),
    }
}

// ============================================================================
// Country Code Fixtures
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeRequest {
    pub country_code: u16,
    pub key_id: String,
}

/// Build a valid country code encryption request.
pub fn encrypt_country_code_request(country_code: u16, key_id: &str) -> EncryptCountryCodeRequest {
    EncryptCountryCodeRequest {
        country_code,
        key_id: key_id.to_string(),
    }
}

// ============================================================================
// Compliance Level Fixtures
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptComplianceLevelRequest {
    pub compliance_level: u8,
    pub key_id: String,
}

/// Build a valid compliance level encryption request.
pub fn encrypt_compliance_level_request(level: u8, key_id: &str) -> EncryptComplianceLevelRequest {
    EncryptComplianceLevelRequest {
        compliance_level: level,
        key_id: key_id.to_string(),
    }
}

// ============================================================================
// Liveness Score Fixtures
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptLivenessRequest {
    pub score: f64,
    pub key_id: String,
}

/// Build a valid liveness score encryption request.
pub fn encrypt_liveness_request(score: f64, key_id: &str) -> EncryptLivenessRequest {
    EncryptLivenessRequest {
        score,
        key_id: key_id.to_string(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdRequest {
    #[serde(with = "serde_bytes")]
    pub ciphertext: Vec<u8>,
    pub threshold: f64,
    pub key_id: String,
}

/// Build a valid liveness threshold verification request.
pub fn verify_liveness_threshold_request(
    ciphertext: &[u8],
    threshold: f64,
    key_id: &str,
) -> VerifyLivenessThresholdRequest {
    VerifyLivenessThresholdRequest {
        ciphertext: ciphertext.to_vec(),
        threshold,
        key_id: key_id.to_string(),
    }
}

// ============================================================================
// Batch Fixtures
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyBatchRequest {
    pub key_id: String,
}

/// Build an empty batch request (no encryption fields set) to trigger InvalidInput.
pub fn empty_batch_request(key_id: &str) -> EmptyBatchRequest {
    EmptyBatchRequest {
        key_id: key_id.to_string(),
    }
}

// ============================================================================
// Malformed Request Fixtures (for negative tests)
// ============================================================================

/// Empty JSON object (missing all required fields).
pub fn empty_object() -> serde_json::Value {
    serde_json::json!({})
}

/// Build a request with a field set to null.
pub fn with_null_field(field: &str) -> serde_json::Value {
    serde_json::json!({
        field: null
    })
}

/// Build a request with a field set to wrong type (number instead of string).
pub fn with_number_instead_of_string(field: &str) -> serde_json::Value {
    serde_json::json!({
        field: 12345
    })
}

/// Malformed JSON string (for parse error tests).
pub fn malformed_json() -> &'static str {
    r#"{ "this is": "not valid json"#
}

/// Build an encrypt request with invalid key id.
pub fn with_invalid_key_id_format() -> serde_json::Value {
    serde_json::json!({
        "dobDays": 40_000,
        "keyId": "not-valid-key-id"
    })
}

/// Build an encrypt request with valid key id format but not registered.
pub fn with_invalid_key_content() -> serde_json::Value {
    serde_json::json!({
        "dobDays": 40_000,
        "keyId": "00000000-0000-0000-0000-000000000001"
    })
}

/// Build a verify request with an invalid/non-existent key ID.
pub fn with_invalid_key_id(ciphertext: &[u8]) -> VerifyAgeFromDobRequest {
    VerifyAgeFromDobRequest {
        ciphertext: ciphertext.to_vec(),
        current_days: 45_650,
        min_age: 18,
        key_id: "00000000-0000-0000-0000-000000000000".to_string(),
    }
}

/// Build a verify request with corrupted ciphertext.
pub fn with_corrupted_ciphertext(key_id: &str) -> VerifyAgeFromDobRequest {
    VerifyAgeFromDobRequest {
        ciphertext: b"this is not a valid ciphertext".to_vec(),
        current_days: 45_650,
        min_age: 18,
        key_id: key_id.to_string(),
    }
}

// ============================================================================
// Boundary Value Fixtures
// ============================================================================

/// DOB days boundary values
pub mod dob_days_boundaries {
    pub const MIN_DAYS: u32 = 0; // 1900-01-01
    pub const TYPICAL_DAYS: u32 = 40_000; // ~2009
    pub const MAX_DAYS: u32 = 150_000; // ~2310
}

/// Country code boundary values
pub mod country_code_boundaries {
    pub const MIN_CODE: u16 = 0;
    pub const MAX_CODE: u16 = 999;
    pub const OVER_MAX_CODE: u16 = 1000;
    pub const USA: u16 = 840;
    pub const GERMANY: u16 = 276;
}

/// Compliance level boundary values
pub mod compliance_boundaries {
    pub const MIN_LEVEL: u8 = 0;
    pub const MAX_LEVEL: u8 = 10;
    pub const OVER_MAX_LEVEL: u8 = 11;
    pub const TYPICAL_LEVEL: u8 = 5;
}

/// Liveness score boundary values
pub mod liveness_boundaries {
    pub const MIN_SCORE: f64 = 0.0;
    pub const MAX_SCORE: f64 = 1.0;
    pub const OVER_MAX_SCORE: f64 = 1.5;
    pub const NEGATIVE_SCORE: f64 = -0.1;
    pub const TYPICAL_SCORE: f64 = 0.85;
    pub const PRECISION_SCORE: f64 = 0.8542;
    pub const TYPICAL_THRESHOLD: f64 = 0.8;
}

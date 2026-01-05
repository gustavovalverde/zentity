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
// Birth Year Offset (Age) Encryption Fixtures
// ============================================================================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBirthYearOffsetRequest {
    pub birth_year_offset: u16,
    pub key_id: String,
}

/// Build a valid birth year offset encryption request.
pub fn encrypt_birth_year_offset_request(
    offset: u16,
    key_id: &str,
) -> EncryptBirthYearOffsetRequest {
    EncryptBirthYearOffsetRequest {
        birth_year_offset: offset,
        key_id: key_id.to_string(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeOffsetRequest {
    #[serde(with = "serde_bytes")]
    pub ciphertext: Vec<u8>,
    pub current_year: u16,
    pub min_age: u16,
    pub key_id: String,
}

/// Build a valid age verification request.
pub fn verify_age_offset_request(
    ciphertext: &[u8],
    current_year: u16,
    min_age: u16,
    key_id: &str,
) -> VerifyAgeOffsetRequest {
    VerifyAgeOffsetRequest {
        ciphertext: ciphertext.to_vec(),
        current_year,
        min_age,
        key_id: key_id.to_string(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeOffsetDefaultMinAgeRequest {
    #[serde(with = "serde_bytes")]
    pub ciphertext: Vec<u8>,
    pub current_year: u16,
    pub key_id: String,
}

/// Build an age verification request without minAge (uses default 18).
pub fn verify_age_offset_request_default_min_age(
    ciphertext: &[u8],
    current_year: u16,
    key_id: &str,
) -> VerifyAgeOffsetDefaultMinAgeRequest {
    VerifyAgeOffsetDefaultMinAgeRequest {
        ciphertext: ciphertext.to_vec(),
        current_year,
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
        "birthYearOffset": 100,
        "keyId": "not-valid-key-id"
    })
}

/// Build an encrypt request with valid key id format but not registered.
pub fn with_invalid_key_content() -> serde_json::Value {
    serde_json::json!({
        "birthYearOffset": 100,
        "keyId": "00000000-0000-0000-0000-000000000001"
    })
}

/// Build a verify request with an invalid/non-existent key ID.
pub fn with_invalid_key_id(ciphertext: &[u8]) -> VerifyAgeOffsetRequest {
    VerifyAgeOffsetRequest {
        ciphertext: ciphertext.to_vec(),
        current_year: 2025,
        min_age: 18,
        key_id: "00000000-0000-0000-0000-000000000000".to_string(),
    }
}

/// Build a verify request with corrupted ciphertext.
pub fn with_corrupted_ciphertext(key_id: &str) -> VerifyAgeOffsetRequest {
    VerifyAgeOffsetRequest {
        ciphertext: b"this is not a valid ciphertext".to_vec(),
        current_year: 2025,
        min_age: 18,
        key_id: key_id.to_string(),
    }
}

// ============================================================================
// Boundary Value Fixtures
// ============================================================================

/// Age offset boundary values
pub mod age_boundaries {
    pub const MIN_OFFSET: u16 = 0; // Year 1900
    pub const MAX_OFFSET: u16 = 255; // Year 2155
    pub const OVER_MAX_OFFSET: u16 = 256;
    pub const TYPICAL_OFFSET: u16 = 100; // Year 2000
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

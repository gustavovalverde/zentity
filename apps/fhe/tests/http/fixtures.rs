//! HTTP request/response fixtures for FHE service tests.
//!
//! Provides helper functions to build valid and invalid request bodies
//! for testing various scenarios.
#![allow(dead_code)]

use serde_json::{json, Value};

// ============================================================================
// Key Registration Fixtures
// ============================================================================

/// Build a valid key registration request body.
pub fn register_key_request(server_key_b64: &str) -> Value {
    json!({
        "serverKey": server_key_b64
    })
}

// ============================================================================
// Birth Year Offset (Age) Encryption Fixtures
// ============================================================================

/// Build a valid birth year offset encryption request.
pub fn encrypt_birth_year_offset_request(offset: u16, public_key_b64: &str) -> Value {
    json!({
        "birthYearOffset": offset,
        "publicKey": public_key_b64
    })
}

/// Build a valid age verification request.
pub fn verify_age_offset_request(
    ciphertext: &str,
    current_year: u16,
    min_age: u16,
    key_id: &str,
) -> Value {
    json!({
        "ciphertext": ciphertext,
        "currentYear": current_year,
        "minAge": min_age,
        "keyId": key_id
    })
}

/// Build an age verification request without minAge (uses default 18).
pub fn verify_age_offset_request_default_min_age(
    ciphertext: &str,
    current_year: u16,
    key_id: &str,
) -> Value {
    json!({
        "ciphertext": ciphertext,
        "currentYear": current_year,
        "keyId": key_id
    })
}

// ============================================================================
// Country Code Fixtures
// ============================================================================

/// Build a valid country code encryption request.
pub fn encrypt_country_code_request(country_code: u16, public_key_b64: &str) -> Value {
    json!({
        "countryCode": country_code,
        "publicKey": public_key_b64
    })
}

// ============================================================================
// Compliance Level Fixtures
// ============================================================================

/// Build a valid compliance level encryption request.
pub fn encrypt_compliance_level_request(level: u8, public_key_b64: &str) -> Value {
    json!({
        "complianceLevel": level,
        "publicKey": public_key_b64
    })
}

// ============================================================================
// Liveness Score Fixtures
// ============================================================================

/// Build a valid liveness score encryption request.
pub fn encrypt_liveness_request(score: f64, public_key_b64: &str) -> Value {
    json!({
        "score": score,
        "publicKey": public_key_b64
    })
}

/// Build a valid liveness threshold verification request.
pub fn verify_liveness_threshold_request(ciphertext: &str, threshold: f64, key_id: &str) -> Value {
    json!({
        "ciphertext": ciphertext,
        "threshold": threshold,
        "keyId": key_id
    })
}

// ============================================================================
// Malformed Request Fixtures (for negative tests)
// ============================================================================

/// Empty JSON object (missing all required fields).
pub fn empty_object() -> Value {
    json!({})
}

/// Build a request with a field set to null.
pub fn with_null_field(field: &str) -> Value {
    json!({
        field: null
    })
}

/// Build a request with a field set to wrong type (number instead of string).
pub fn with_number_instead_of_string(field: &str) -> Value {
    json!({
        field: 12345
    })
}

/// Malformed JSON string (for parse error tests).
pub fn malformed_json() -> &'static str {
    r#"{ "this is": "not valid json"#
}

/// Build an encrypt request with invalid base64 public key.
pub fn with_invalid_base64_key() -> Value {
    json!({
        "birthYearOffset": 100,
        "publicKey": "not-valid-base64!!!"
    })
}

/// Build an encrypt request with valid base64 but invalid key content.
pub fn with_invalid_key_content() -> Value {
    // Valid base64, but not a valid serialized key
    json!({
        "birthYearOffset": 100,
        "publicKey": "SGVsbG8gV29ybGQh" // "Hello World!" in base64
    })
}

/// Build a verify request with an invalid/non-existent key ID.
pub fn with_invalid_key_id(ciphertext: &str) -> Value {
    json!({
        "ciphertext": ciphertext,
        "currentYear": 2025,
        "minAge": 18,
        "keyId": "00000000-0000-0000-0000-000000000000"
    })
}

/// Build a verify request with corrupted ciphertext.
pub fn with_corrupted_ciphertext(key_id: &str) -> Value {
    json!({
        "ciphertext": "dGhpcyBpcyBub3QgYSB2YWxpZCBjaXBoZXJ0ZXh0", // "this is not a valid ciphertext"
        "currentYear": 2025,
        "minAge": 18,
        "keyId": key_id
    })
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

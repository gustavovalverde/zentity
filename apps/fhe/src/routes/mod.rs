//! HTTP Route handlers

use crate::crypto;
use crate::error::FheError;
use axum::Json;
use serde::{Deserialize, Serialize};

// Health check response
#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
    service: String,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "fhe-service".to_string(),
    })
}

// Build info response for verification
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfoResponse {
    service: String,
    version: String,
    git_sha: String,
    build_time: String,
}

/// Build info endpoint for deployment verification.
/// Allows users to verify the deployed code matches the source.
/// Values are embedded at compile time via build.rs.
pub async fn build_info() -> Json<BuildInfoResponse> {
    Json(BuildInfoResponse {
        service: "fhe-service".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_sha: env!("GIT_SHA").to_string(),
        build_time: env!("BUILD_TIME").to_string(),
    })
}

// Key registration
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyRequest {
    /// Base64-encoded compressed server key (bincode serialized)
    server_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyResponse {
    key_id: String,
}

pub async fn register_key(
    Json(payload): Json<RegisterKeyRequest>,
) -> Result<Json<RegisterKeyResponse>, FheError> {
    let server_key = crypto::decode_server_key(&payload.server_key)?;
    let key_store = crypto::get_key_store();
    let key_id = key_store.register_server_key(server_key);

    Ok(Json(RegisterKeyResponse { key_id }))
}

// Birth year offset encryption
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBirthYearOffsetRequest {
    /// Years since 1900 (0-255)
    birth_year_offset: u16,
    /// Base64-encoded compressed public key (bincode serialized).
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBirthYearOffsetResponse {
    ciphertext: String,
}

pub async fn encrypt_birth_year_offset(
    Json(payload): Json<EncryptBirthYearOffsetRequest>,
) -> Result<Json<EncryptBirthYearOffsetResponse>, FheError> {
    let ciphertext =
        crypto::encrypt_birth_year_offset(payload.birth_year_offset, &payload.public_key)?;

    Ok(Json(EncryptBirthYearOffsetResponse { ciphertext }))
}

// Verify age request/response (birth year offset)
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeOffsetRequest {
    ciphertext: String,
    current_year: u16,
    #[serde(default = "default_min_age")]
    min_age: u16,
    key_id: String,
}

fn default_min_age() -> u16 {
    18
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeOffsetResponse {
    result_ciphertext: String,
}

pub async fn verify_age_offset(
    Json(payload): Json<VerifyAgeOffsetRequest>,
) -> Result<Json<VerifyAgeOffsetResponse>, FheError> {
    let result_ciphertext = crypto::verify_age_offset(
        &payload.ciphertext,
        payload.current_year,
        payload.min_age,
        &payload.key_id,
    )?;

    Ok(Json(VerifyAgeOffsetResponse { result_ciphertext }))
}

// ============================================================================
// Country Code Encryption
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeRequest {
    /// ISO 3166-1 numeric code (0-999)
    country_code: u16,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeResponse {
    ciphertext: String,
    country_code: u16,
}

pub async fn encrypt_country_code(
    Json(payload): Json<EncryptCountryCodeRequest>,
) -> Result<Json<EncryptCountryCodeResponse>, FheError> {
    let ciphertext = crypto::encrypt_country_code(payload.country_code, &payload.public_key)?;

    Ok(Json(EncryptCountryCodeResponse {
        ciphertext,
        country_code: payload.country_code,
    }))
}

// ============================================================================
// Compliance Level Encryption
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptComplianceLevelRequest {
    /// Compliance tier (0-10)
    compliance_level: u8,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptComplianceLevelResponse {
    ciphertext: String,
    compliance_level: u8,
}

pub async fn encrypt_compliance_level(
    Json(payload): Json<EncryptComplianceLevelRequest>,
) -> Result<Json<EncryptComplianceLevelResponse>, FheError> {
    let ciphertext =
        crypto::encrypt_compliance_level(payload.compliance_level, &payload.public_key)?;

    Ok(Json(EncryptComplianceLevelResponse {
        ciphertext,
        compliance_level: payload.compliance_level,
    }))
}

// ============================================================================
// Liveness Score Encryption
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptLivenessRequest {
    /// Liveness score from 0.0 to 1.0
    score: f64,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptLivenessResponse {
    ciphertext: String,
    /// Original score that was encrypted (for confirmation)
    score: f64,
}

pub async fn encrypt_liveness(
    Json(payload): Json<EncryptLivenessRequest>,
) -> Result<Json<EncryptLivenessResponse>, FheError> {
    let ciphertext = crypto::encrypt_liveness_score(payload.score, &payload.public_key)?;

    Ok(Json(EncryptLivenessResponse {
        ciphertext,
        score: payload.score,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdRequest {
    ciphertext: String,
    /// Minimum required score (0.0 to 1.0)
    threshold: f64,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdResponse {
    passes_ciphertext: String,
    threshold: f64,
}

pub async fn verify_liveness_threshold(
    Json(payload): Json<VerifyLivenessThresholdRequest>,
) -> Result<Json<VerifyLivenessThresholdResponse>, FheError> {
    let passes_ciphertext =
        crypto::verify_liveness_threshold(&payload.ciphertext, payload.threshold, &payload.key_id)?;

    Ok(Json(VerifyLivenessThresholdResponse {
        passes_ciphertext,
        threshold: payload.threshold,
    }))
}

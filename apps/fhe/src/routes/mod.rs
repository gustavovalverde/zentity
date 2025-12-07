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

// Key generation
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeysResponse {
    client_key_id: String,
}

pub async fn generate_keys() -> Json<GenerateKeysResponse> {
    let key_store = crypto::get_key_store();
    let key_id = key_store.generate_client_key();

    Json(GenerateKeysResponse {
        client_key_id: key_id,
    })
}

// Encrypt request/response
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptRequest {
    birth_year: u16,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

fn default_key_id() -> String {
    "default".to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptResponse {
    ciphertext: String,
    client_key_id: String,
}

pub async fn encrypt(
    Json(payload): Json<EncryptRequest>,
) -> Result<Json<EncryptResponse>, FheError> {
    let ciphertext = crypto::encrypt_birth_year(payload.birth_year, &payload.client_key_id)?;

    Ok(Json(EncryptResponse {
        ciphertext,
        client_key_id: payload.client_key_id,
    }))
}

// Verify age request/response
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeRequest {
    ciphertext: String,
    current_year: u16,
    #[serde(default = "default_min_age")]
    min_age: u16,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

fn default_min_age() -> u16 {
    18
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeResponse {
    is_over_18: bool,
    computation_time_ms: u64,
}

pub async fn verify_age(
    Json(payload): Json<VerifyAgeRequest>,
) -> Result<Json<VerifyAgeResponse>, FheError> {
    let (is_over_18, computation_time_ms) = crypto::verify_age(
        &payload.ciphertext,
        payload.current_year,
        payload.min_age,
        &payload.client_key_id,
    )?;

    Ok(Json(VerifyAgeResponse {
        is_over_18,
        computation_time_ms,
    }))
}

// ============================================================================
// Gender Encryption (ISO/IEC 5218)
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptGenderRequest {
    /// Gender code per ISO/IEC 5218: 0=NotKnown, 1=Male, 2=Female, 9=NotApplicable
    gender_code: u8,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptGenderResponse {
    ciphertext: String,
    client_key_id: String,
    gender_code: u8,
}

pub async fn encrypt_gender(
    Json(payload): Json<EncryptGenderRequest>,
) -> Result<Json<EncryptGenderResponse>, FheError> {
    let ciphertext = crypto::encrypt_gender(payload.gender_code, &payload.client_key_id)?;

    Ok(Json(EncryptGenderResponse {
        ciphertext,
        client_key_id: payload.client_key_id,
        gender_code: payload.gender_code,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyGenderRequest {
    ciphertext: String,
    /// Claimed gender code to verify against
    claimed_gender: u8,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyGenderResponse {
    matches: bool,
    computation_time_ms: u64,
}

pub async fn verify_gender(
    Json(payload): Json<VerifyGenderRequest>,
) -> Result<Json<VerifyGenderResponse>, FheError> {
    let (matches, computation_time_ms) = crypto::verify_gender_match(
        &payload.ciphertext,
        payload.claimed_gender,
        &payload.client_key_id,
    )?;

    Ok(Json(VerifyGenderResponse {
        matches,
        computation_time_ms,
    }))
}

// ============================================================================
// Full DOB Encryption (YYYYMMDD as u32)
// ============================================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptDobRequest {
    /// Date of birth as YYYYMMDD integer or ISO 8601 string (YYYY-MM-DD)
    dob: String,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptDobResponse {
    ciphertext: String,
    client_key_id: String,
    /// DOB as YYYYMMDD integer
    dob_int: u32,
}

pub async fn encrypt_dob(
    Json(payload): Json<EncryptDobRequest>,
) -> Result<Json<EncryptDobResponse>, FheError> {
    // Parse the date string to YYYYMMDD integer
    let dob_int = crypto::parse_date_to_int(&payload.dob)?;

    let ciphertext = crypto::encrypt_dob(dob_int, &payload.client_key_id)?;

    Ok(Json(EncryptDobResponse {
        ciphertext,
        client_key_id: payload.client_key_id,
        dob_int,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgePreciseRequest {
    ciphertext: String,
    /// Current date as YYYYMMDD integer (optional, defaults to today)
    current_date: Option<u32>,
    #[serde(default = "default_min_age")]
    min_age: u16,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgePreciseResponse {
    is_over_age: bool,
    min_age: u16,
    current_date: u32,
    computation_time_ms: u64,
}

pub async fn verify_age_precise(
    Json(payload): Json<VerifyAgePreciseRequest>,
) -> Result<Json<VerifyAgePreciseResponse>, FheError> {
    let current_date = payload.current_date.unwrap_or_else(crypto::get_current_date_int);

    let (is_over_age, computation_time_ms) = crypto::verify_age_precise(
        &payload.ciphertext,
        current_date,
        payload.min_age,
        &payload.client_key_id,
    )?;

    Ok(Json(VerifyAgePreciseResponse {
        is_over_age,
        min_age: payload.min_age,
        current_date,
        computation_time_ms,
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
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptLivenessResponse {
    ciphertext: String,
    client_key_id: String,
    /// Original score that was encrypted (for confirmation)
    score: f64,
}

pub async fn encrypt_liveness(
    Json(payload): Json<EncryptLivenessRequest>,
) -> Result<Json<EncryptLivenessResponse>, FheError> {
    let ciphertext = crypto::encrypt_liveness_score(payload.score, &payload.client_key_id)?;

    Ok(Json(EncryptLivenessResponse {
        ciphertext,
        client_key_id: payload.client_key_id,
        score: payload.score,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdRequest {
    ciphertext: String,
    /// Minimum required score (0.0 to 1.0)
    threshold: f64,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdResponse {
    passes_threshold: bool,
    threshold: f64,
    computation_time_ms: u64,
}

pub async fn verify_liveness_threshold(
    Json(payload): Json<VerifyLivenessThresholdRequest>,
) -> Result<Json<VerifyLivenessThresholdResponse>, FheError> {
    let (passes_threshold, computation_time_ms) = crypto::verify_liveness_threshold(
        &payload.ciphertext,
        payload.threshold,
        &payload.client_key_id,
    )?;

    Ok(Json(VerifyLivenessThresholdResponse {
        passes_threshold,
        threshold: payload.threshold,
        computation_time_ms,
    }))
}

//! Age verification endpoints (birth year offset).

use axum::Json;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;

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

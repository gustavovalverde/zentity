//! Liveness score encryption and verification endpoints.

use axum::Json;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;

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

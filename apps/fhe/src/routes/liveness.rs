//! Liveness score encryption and verification endpoints.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;
use crate::transport;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptLivenessRequest {
    /// Liveness score from 0.0 to 1.0
    score: f64,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptLivenessResponse {
    ciphertext: String,
    /// Original score that was encrypted (for confirmation)
    score: f64,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_liveness(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: EncryptLivenessRequest = transport::decode_msgpack(&headers, body)?;
    let public_key = crypto::get_public_key_for_encryption(&payload.key_id)?;
    let ciphertext = crypto::encrypt_liveness_score(payload.score, &public_key)?;

    transport::encode_msgpack(
        &headers,
        &EncryptLivenessResponse {
            ciphertext,
            score: payload.score,
        },
    )
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

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn verify_liveness_threshold(
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, FheError> {
    let payload: VerifyLivenessThresholdRequest = transport::decode_msgpack(&headers, body)?;
    let passes_ciphertext =
        crypto::verify_liveness_threshold(&payload.ciphertext, payload.threshold, &payload.key_id)?;

    transport::encode_msgpack(
        &headers,
        &VerifyLivenessThresholdResponse {
            passes_ciphertext,
            threshold: payload.threshold,
        },
    )
}

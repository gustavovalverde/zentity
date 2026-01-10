//! Liveness score encryption and verification endpoints.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use tracing::info_span;

use super::run_cpu_bound;
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
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    /// Original score that was encrypted (for confirmation)
    score: f64,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_liveness(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: EncryptLivenessRequest = transport::decode_msgpack(&headers, body)?;
    let EncryptLivenessRequest { score, key_id } = payload;
    let ciphertext = run_cpu_bound(move || {
        let public_key = info_span!("fhe.get_public_key", key_id = %key_id)
            .in_scope(|| crypto::get_public_key_for_encryption(&key_id))?;
        info_span!("fhe.encrypt.liveness_score", value = %score)
            .in_scope(|| crypto::encrypt_liveness_score(score, &public_key))
    })
    .await?;

    transport::encode_msgpack(&headers, &EncryptLivenessResponse { ciphertext, score })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdRequest {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    /// Minimum required score (0.0 to 1.0)
    threshold: f64,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdResponse {
    #[serde(with = "serde_bytes")]
    passes_ciphertext: Vec<u8>,
    threshold: f64,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn verify_liveness_threshold(
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, FheError> {
    let payload: VerifyLivenessThresholdRequest = transport::decode_msgpack(&headers, body)?;
    let VerifyLivenessThresholdRequest {
        ciphertext,
        threshold,
        key_id,
    } = payload;
    let ciphertext_bytes = ciphertext.len();
    let passes_ciphertext = run_cpu_bound(move || {
        info_span!(
            "fhe.verify.liveness_threshold",
            key_id = %key_id,
            threshold = %threshold,
            ciphertext_bytes = ciphertext_bytes
        )
        .in_scope(|| crypto::verify_liveness_threshold(&ciphertext, threshold, &key_id))
    })
    .await?;

    transport::encode_msgpack(
        &headers,
        &VerifyLivenessThresholdResponse {
            passes_ciphertext,
            threshold,
        },
    )
}

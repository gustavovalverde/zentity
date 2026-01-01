//! Batch encryption endpoint for multiple attributes.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;
use crate::transport;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBatchRequest {
    key_id: String,
    birth_year_offset: Option<u16>,
    country_code: Option<u16>,
    compliance_level: Option<u8>,
    liveness_score: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBatchResponse {
    birth_year_offset_ciphertext: Option<String>,
    country_code_ciphertext: Option<String>,
    compliance_level_ciphertext: Option<String>,
    liveness_score_ciphertext: Option<String>,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_batch(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: EncryptBatchRequest = transport::decode_msgpack(&headers, body)?;

    if payload.birth_year_offset.is_none()
        && payload.country_code.is_none()
        && payload.compliance_level.is_none()
        && payload.liveness_score.is_none()
    {
        return Err(FheError::InvalidInput(
            "At least one attribute must be provided".to_string(),
        ));
    }

    let public_key = crypto::get_public_key_for_encryption(&payload.key_id)?;

    let birth_year_offset_ciphertext = payload
        .birth_year_offset
        .map(|value| crypto::encrypt_birth_year_offset(value, &public_key))
        .transpose()?;

    let country_code_ciphertext = payload
        .country_code
        .map(|value| crypto::encrypt_country_code(value, &public_key))
        .transpose()?;

    let compliance_level_ciphertext = payload
        .compliance_level
        .map(|value| crypto::encrypt_compliance_level(value, &public_key))
        .transpose()?;

    let liveness_score_ciphertext = payload
        .liveness_score
        .map(|value| crypto::encrypt_liveness_score(value, &public_key))
        .transpose()?;

    transport::encode_msgpack(
        &headers,
        &EncryptBatchResponse {
            birth_year_offset_ciphertext,
            country_code_ciphertext,
            compliance_level_ciphertext,
            liveness_score_ciphertext,
        },
    )
}

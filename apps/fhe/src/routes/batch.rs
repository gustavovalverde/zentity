//! Batch encryption endpoint for multiple attributes.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;

use super::run_cpu_bound;
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
    birth_year_offset_ciphertext: Option<ByteBuf>,
    country_code_ciphertext: Option<ByteBuf>,
    compliance_level_ciphertext: Option<ByteBuf>,
    liveness_score_ciphertext: Option<ByteBuf>,
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

    let EncryptBatchRequest {
        key_id,
        birth_year_offset,
        country_code,
        compliance_level,
        liveness_score,
    } = payload;

    let response = run_cpu_bound(move || {
        let public_key = crypto::get_public_key_for_encryption(&key_id)?;

        let birth_year_offset_ciphertext = birth_year_offset
            .map(|value| crypto::encrypt_birth_year_offset(value, &public_key))
            .transpose()?
            .map(ByteBuf::from);

        let country_code_ciphertext = country_code
            .map(|value| crypto::encrypt_country_code(value, &public_key))
            .transpose()?
            .map(ByteBuf::from);

        let compliance_level_ciphertext = compliance_level
            .map(|value| crypto::encrypt_compliance_level(value, &public_key))
            .transpose()?
            .map(ByteBuf::from);

        let liveness_score_ciphertext = liveness_score
            .map(|value| crypto::encrypt_liveness_score(value, &public_key))
            .transpose()?
            .map(ByteBuf::from);

        Ok(EncryptBatchResponse {
            birth_year_offset_ciphertext,
            country_code_ciphertext,
            compliance_level_ciphertext,
            liveness_score_ciphertext,
        })
    })
    .await?;

    transport::encode_msgpack(&headers, &response)
}

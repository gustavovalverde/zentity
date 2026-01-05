//! Age verification endpoints (birth year offset).

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use super::run_cpu_bound;
use crate::crypto;
use crate::error::FheError;
use crate::transport;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBirthYearOffsetRequest {
    /// Years since 1900 (0-255)
    birth_year_offset: u16,
    /// Registered key ID for public key lookup.
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBirthYearOffsetResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_birth_year_offset(
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, FheError> {
    let payload: EncryptBirthYearOffsetRequest = transport::decode_msgpack(&headers, body)?;
    let EncryptBirthYearOffsetRequest {
        birth_year_offset,
        key_id,
    } = payload;
    let ciphertext = run_cpu_bound(move || {
        let public_key = crypto::get_public_key_for_encryption(&key_id)?;
        crypto::encrypt_birth_year_offset(birth_year_offset, &public_key)
    })
    .await?;

    transport::encode_msgpack(&headers, &EncryptBirthYearOffsetResponse { ciphertext })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeOffsetRequest {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
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
    #[serde(with = "serde_bytes")]
    result_ciphertext: Vec<u8>,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn verify_age_offset(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: VerifyAgeOffsetRequest = transport::decode_msgpack(&headers, body)?;
    let VerifyAgeOffsetRequest {
        ciphertext,
        current_year,
        min_age,
        key_id,
    } = payload;
    let result_ciphertext = run_cpu_bound(move || {
        crypto::verify_age_offset(&ciphertext, current_year, min_age, &key_id)
    })
    .await?;

    transport::encode_msgpack(&headers, &VerifyAgeOffsetResponse { result_ciphertext })
}

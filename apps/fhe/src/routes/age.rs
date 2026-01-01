//! Age verification endpoints (birth year offset).

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

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
    ciphertext: String,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_birth_year_offset(
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, FheError> {
    let payload: EncryptBirthYearOffsetRequest = transport::decode_msgpack(&headers, body)?;
    let public_key = crypto::get_public_key_for_encryption(&payload.key_id)?;
    let ciphertext = crypto::encrypt_birth_year_offset(payload.birth_year_offset, &public_key)?;

    transport::encode_msgpack(&headers, &EncryptBirthYearOffsetResponse { ciphertext })
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

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn verify_age_offset(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: VerifyAgeOffsetRequest = transport::decode_msgpack(&headers, body)?;
    let result_ciphertext = crypto::verify_age_offset(
        &payload.ciphertext,
        payload.current_year,
        payload.min_age,
        &payload.key_id,
    )?;

    transport::encode_msgpack(&headers, &VerifyAgeOffsetResponse { result_ciphertext })
}

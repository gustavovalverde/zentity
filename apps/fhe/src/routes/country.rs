//! Country code encryption endpoint.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;
use crate::transport;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeRequest {
    /// ISO 3166-1 numeric code (0-999)
    country_code: u16,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeResponse {
    ciphertext: String,
    country_code: u16,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_country_code(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: EncryptCountryCodeRequest = transport::decode_msgpack(&headers, body)?;
    let public_key = crypto::get_public_key_for_encryption(&payload.key_id)?;
    let ciphertext = crypto::encrypt_country_code(payload.country_code, &public_key)?;

    transport::encode_msgpack(
        &headers,
        &EncryptCountryCodeResponse {
            ciphertext,
            country_code: payload.country_code,
        },
    )
}

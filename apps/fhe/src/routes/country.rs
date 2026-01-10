//! Country code encryption endpoint.

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
pub struct EncryptCountryCodeRequest {
    /// ISO 3166-1 numeric code (0-999)
    country_code: u16,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    country_code: u16,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_country_code(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: EncryptCountryCodeRequest = transport::decode_msgpack(&headers, body)?;
    let EncryptCountryCodeRequest {
        country_code,
        key_id,
    } = payload;
    let ciphertext = run_cpu_bound(move || {
        let public_key = info_span!("fhe.get_public_key", key_id = %key_id)
            .in_scope(|| crypto::get_public_key_for_encryption(&key_id))?;
        info_span!("fhe.encrypt.country_code", value = country_code)
            .in_scope(|| crypto::encrypt_country_code(country_code, &public_key))
    })
    .await?;

    transport::encode_msgpack(
        &headers,
        &EncryptCountryCodeResponse {
            ciphertext,
            country_code,
        },
    )
}

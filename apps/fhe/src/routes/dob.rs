//! Date of Birth endpoints (`dobDays`).

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
pub struct EncryptDobDaysRequest {
    /// Days since 1900-01-01 (UTC)
    dob_days: u32,
    /// Registered key ID for public key lookup.
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptDobDaysResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_dob_days(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: EncryptDobDaysRequest = transport::decode_msgpack(&headers, body)?;
    let EncryptDobDaysRequest { dob_days, key_id } = payload;
    let ciphertext = run_cpu_bound(move || {
        let public_key = info_span!("fhe.get_public_key", key_id = %key_id)
            .in_scope(|| crypto::get_public_key_for_encryption(&key_id))?;
        info_span!("fhe.encrypt.dob_days", value = dob_days)
            .in_scope(|| crypto::encrypt_dob_days(dob_days, &public_key))
    })
    .await?;

    transport::encode_msgpack(&headers, &EncryptDobDaysResponse { ciphertext })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeFromDobRequest {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    /// Today's date as days since 1900-01-01 (UTC)
    current_days: u32,
    #[serde(default = "default_min_age")]
    min_age: u16,
    key_id: String,
}

fn default_min_age() -> u16 {
    18
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeFromDobResponse {
    #[serde(with = "serde_bytes")]
    result_ciphertext: Vec<u8>,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn verify_age_from_dob(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: VerifyAgeFromDobRequest = transport::decode_msgpack(&headers, body)?;
    let VerifyAgeFromDobRequest {
        ciphertext,
        current_days,
        min_age,
        key_id,
    } = payload;
    let ciphertext_bytes = ciphertext.len();
    let result_ciphertext = run_cpu_bound(move || {
        info_span!(
            "fhe.verify.age_from_dob",
            key_id = %key_id,
            current_days = current_days,
            min_age = min_age,
            ciphertext_bytes = ciphertext_bytes
        )
        .in_scope(|| crypto::verify_age_from_dob(&ciphertext, current_days, min_age, &key_id))
    })
    .await?;

    transport::encode_msgpack(&headers, &VerifyAgeFromDobResponse { result_ciphertext })
}

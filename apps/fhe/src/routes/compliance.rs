//! Compliance level encryption endpoint.

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
pub struct EncryptComplianceLevelRequest {
    /// Compliance tier (0-10)
    compliance_level: u8,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptComplianceLevelResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    compliance_level: u8,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_compliance_level(
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, FheError> {
    let payload: EncryptComplianceLevelRequest = transport::decode_msgpack(&headers, body)?;
    let EncryptComplianceLevelRequest {
        compliance_level,
        key_id,
    } = payload;
    let ciphertext = run_cpu_bound(move || {
        let public_key = info_span!("fhe.get_public_key", key_id = %key_id)
            .in_scope(|| crypto::get_public_key_for_encryption(&key_id))?;
        info_span!("fhe.encrypt.compliance_level", value = compliance_level)
            .in_scope(|| crypto::encrypt_compliance_level(compliance_level, &public_key))
    })
    .await?;

    transport::encode_msgpack(
        &headers,
        &EncryptComplianceLevelResponse {
            ciphertext,
            compliance_level,
        },
    )
}

//! Compliance level encryption endpoint.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};

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
    ciphertext: String,
    compliance_level: u8,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_compliance_level(
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, FheError> {
    let payload: EncryptComplianceLevelRequest = transport::decode_msgpack(&headers, body)?;
    let public_key = crypto::get_public_key_for_encryption(&payload.key_id)?;
    let ciphertext = crypto::encrypt_compliance_level(payload.compliance_level, &public_key)?;

    transport::encode_msgpack(
        &headers,
        &EncryptComplianceLevelResponse {
            ciphertext,
            compliance_level: payload.compliance_level,
        },
    )
}

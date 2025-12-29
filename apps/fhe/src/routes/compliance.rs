//! Compliance level encryption endpoint.

use axum::Json;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptComplianceLevelRequest {
    /// Compliance tier (0-10)
    compliance_level: u8,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptComplianceLevelResponse {
    ciphertext: String,
    compliance_level: u8,
}

pub async fn encrypt_compliance_level(
    Json(payload): Json<EncryptComplianceLevelRequest>,
) -> Result<Json<EncryptComplianceLevelResponse>, FheError> {
    let ciphertext =
        crypto::encrypt_compliance_level(payload.compliance_level, &payload.public_key)?;

    Ok(Json(EncryptComplianceLevelResponse {
        ciphertext,
        compliance_level: payload.compliance_level,
    }))
}

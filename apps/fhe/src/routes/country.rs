//! Country code encryption endpoint.

use axum::Json;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeRequest {
    /// ISO 3166-1 numeric code (0-999)
    country_code: u16,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptCountryCodeResponse {
    ciphertext: String,
    country_code: u16,
}

pub async fn encrypt_country_code(
    Json(payload): Json<EncryptCountryCodeRequest>,
) -> Result<Json<EncryptCountryCodeResponse>, FheError> {
    let ciphertext = crypto::encrypt_country_code(payload.country_code, &payload.public_key)?;

    Ok(Json(EncryptCountryCodeResponse {
        ciphertext,
        country_code: payload.country_code,
    }))
}

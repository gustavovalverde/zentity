//! HTTP Route handlers

use crate::crypto;
use crate::error::FheError;
use axum::Json;
use serde::{Deserialize, Serialize};

// Health check response
#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
    service: String,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "fhe-service".to_string(),
    })
}

// Key generation
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeysResponse {
    client_key_id: String,
}

pub async fn generate_keys() -> Json<GenerateKeysResponse> {
    let key_store = crypto::get_key_store();
    let key_id = key_store.generate_client_key();

    Json(GenerateKeysResponse {
        client_key_id: key_id,
    })
}

// Encrypt request/response
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptRequest {
    birth_year: u16,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

fn default_key_id() -> String {
    "default".to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptResponse {
    ciphertext: String,
    client_key_id: String,
}

pub async fn encrypt(
    Json(payload): Json<EncryptRequest>,
) -> Result<Json<EncryptResponse>, FheError> {
    let ciphertext = crypto::encrypt_birth_year(payload.birth_year, &payload.client_key_id)?;

    Ok(Json(EncryptResponse {
        ciphertext,
        client_key_id: payload.client_key_id,
    }))
}

// Verify age request/response
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeRequest {
    ciphertext: String,
    current_year: u16,
    #[serde(default = "default_min_age")]
    min_age: u16,
    #[serde(default = "default_key_id")]
    client_key_id: String,
}

fn default_min_age() -> u16 {
    18
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeResponse {
    is_over_18: bool,
    computation_time_ms: u64,
}

pub async fn verify_age(
    Json(payload): Json<VerifyAgeRequest>,
) -> Result<Json<VerifyAgeResponse>, FheError> {
    let (is_over_18, computation_time_ms) = crypto::verify_age(
        &payload.ciphertext,
        payload.current_year,
        payload.min_age,
        &payload.client_key_id,
    )?;

    Ok(Json(VerifyAgeResponse {
        is_over_18,
        computation_time_ms,
    }))
}

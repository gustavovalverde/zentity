//! Key registration endpoints.

use axum::Json;
use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::FheError;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyRequest {
    /// Base64-encoded compressed server key (bincode serialized)
    server_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyResponse {
    key_id: String,
}

#[tracing::instrument(skip(payload), fields(server_key_bytes = payload.server_key.len()))]
pub async fn register_key(
    Json(payload): Json<RegisterKeyRequest>,
) -> Result<Json<RegisterKeyResponse>, FheError> {
    let server_key = crypto::decode_server_key(&payload.server_key)?;
    let key_store = crypto::get_key_store();
    let key_id = key_store.register_server_key(server_key);

    Ok(Json(RegisterKeyResponse { key_id }))
}

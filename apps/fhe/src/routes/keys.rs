//! Key registration endpoints.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use axum::Json;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use tfhe::{generate_keys, CompressedPublicKey, CompressedServerKey, ConfigBuilder};

use crate::crypto;
use crate::error::FheError;
use crate::transport;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyRequest {
    /// Base64-encoded compressed server key (bincode serialized)
    server_key: String,
    /// Base64-encoded compressed public key (bincode serialized)
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyResponse {
    key_id: String,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn register_key(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: RegisterKeyRequest = transport::decode_msgpack(&headers, body)?;
    let server_key = crypto::decode_server_key(&payload.server_key)?;
    let public_key = crypto::decode_compressed_public_key(&payload.public_key)?;
    let key_store = crypto::get_key_store();
    let key_id = key_store.register_key(public_key, server_key);

    transport::encode_msgpack(&headers, &RegisterKeyResponse { key_id })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugKeyResponse {
    public_key: String,
    key_id: String,
}

fn debug_keys_enabled() -> bool {
    matches!(
        std::env::var("FHE_DEBUG_KEYS").as_deref(),
        Ok("true") | Ok("1") | Ok("yes")
    )
}

#[tracing::instrument]
pub async fn debug_keys() -> Result<Json<DebugKeyResponse>, FheError> {
    if !debug_keys_enabled() {
        return Err(FheError::InvalidInput(
            "Debug keys are disabled".to_string(),
        ));
    }

    let config = ConfigBuilder::default().build();
    let (client_key, _server_key) = generate_keys(config);
    let public_key = CompressedPublicKey::new(&client_key);
    let server_key = CompressedServerKey::new(&client_key).decompress();
    let key_id = crypto::get_key_store().register_key(public_key.clone(), server_key);
    let public_key_b64 = BASE64.encode(bincode::serialize(&public_key)?);

    Ok(Json(DebugKeyResponse {
        public_key: public_key_b64,
        key_id,
    }))
}

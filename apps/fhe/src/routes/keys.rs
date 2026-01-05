//! Key registration endpoints.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tfhe::{generate_keys, CompressedPublicKey, CompressedServerKey, ConfigBuilder};

use super::run_cpu_bound;
use crate::crypto;
use crate::error::FheError;
use crate::transport;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyRequest {
    /// Compressed server key (bincode serialized)
    #[serde(with = "serde_bytes")]
    server_key: Vec<u8>,
    /// Compressed public key (bincode serialized)
    #[serde(with = "serde_bytes")]
    public_key: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterKeyResponse {
    key_id: String,
}

#[tracing::instrument(
    skip(headers, body),
    fields(request_bytes = body.len(), decode_ms = tracing::field::Empty)
)]
pub async fn register_key(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: RegisterKeyRequest = transport::decode_msgpack(&headers, body)?;
    let RegisterKeyRequest {
        server_key,
        public_key,
    } = payload;
    let (key_id, decode_ms) = run_cpu_bound(move || {
        let decode_start = Instant::now();
        let server_key = crypto::decode_compressed_server_key(&server_key)?;
        let public_key = crypto::decode_compressed_public_key(&public_key)?;
        let decode_ms = decode_start.elapsed().as_millis();
        let key_store = crypto::get_key_store();
        let key_id = key_store.register_key(public_key, server_key)?;
        Ok((key_id, decode_ms))
    })
    .await?;
    tracing::Span::current().record("decode_ms", tracing::field::display(decode_ms));

    transport::encode_msgpack(&headers, &RegisterKeyResponse { key_id })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugKeyResponse {
    #[serde(with = "serde_bytes")]
    public_key: Vec<u8>,
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

    let response = run_cpu_bound(move || {
        let config = ConfigBuilder::default().build();
        let (client_key, _server_key) = generate_keys(config);
        let public_key = CompressedPublicKey::new(&client_key);
        let server_key = CompressedServerKey::new(&client_key);
        let key_id = crypto::get_key_store().register_key(public_key.clone(), server_key)?;
        let public_key_bytes = bincode::serialize(&public_key)?;

        Ok(DebugKeyResponse {
            public_key: public_key_bytes,
            key_id,
        })
    })
    .await?;

    Ok(Json(response))
}

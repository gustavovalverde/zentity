//! Key registration endpoints.

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tracing::info_span;

use super::run_cpu_bound;
use crate::crypto;
use crate::error::FheError;
use crate::transport;

const MIN_KEY_BYTES: usize = 16;
const MAX_PUBLIC_KEY_BYTES: usize = 16 * 1024 * 1024; // 16 MB
const MAX_SERVER_KEY_BYTES: usize = 48 * 1024 * 1024; // 48 MB

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

fn validate_key_sizes(public_key_bytes: usize, server_key_bytes: usize) -> Result<(), FheError> {
    if public_key_bytes < MIN_KEY_BYTES || server_key_bytes < MIN_KEY_BYTES {
        return Err(FheError::InvalidInput(
            "FHE key payload is too small".to_string(),
        ));
    }

    if public_key_bytes > MAX_PUBLIC_KEY_BYTES {
        return Err(FheError::InvalidInput(format!(
            "Public key exceeds {} bytes",
            MAX_PUBLIC_KEY_BYTES
        )));
    }

    if server_key_bytes > MAX_SERVER_KEY_BYTES {
        return Err(FheError::InvalidInput(format!(
            "Server key exceeds {} bytes",
            MAX_SERVER_KEY_BYTES
        )));
    }

    Ok(())
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
    let server_key_bytes = server_key.len();
    let public_key_bytes = public_key.len();
    validate_key_sizes(public_key_bytes, server_key_bytes)?;

    let (key_id, decode_ms) = run_cpu_bound(move || {
        let decode_start = Instant::now();
        let server_key = info_span!("fhe.decode_server_key", bytes = server_key_bytes)
            .in_scope(|| crypto::decode_compressed_server_key(&server_key))?;

        let public_key = info_span!("fhe.decode_public_key", bytes = public_key_bytes)
            .in_scope(|| crypto::decode_compressed_public_key(&public_key))?;

        let decode_ms = decode_start.elapsed().as_millis();

        let key_id = info_span!("fhe.register_key").in_scope(|| {
            let key_store = crypto::get_key_store();
            key_store.register_key(public_key, server_key)
        })?;

        Ok((key_id, decode_ms))
    })
    .await?;
    tracing::Span::current().record("decode_ms", tracing::field::display(decode_ms));

    transport::encode_msgpack(&headers, &RegisterKeyResponse { key_id })
}

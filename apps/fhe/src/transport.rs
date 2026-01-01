//! Binary transport helpers for msgpack + gzip payloads.

use axum::body::Bytes;
use axum::http::header::{ACCEPT_ENCODING, CONTENT_ENCODING, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::io::{Read, Write};

use crate::error::FheError;

fn header_contains(headers: &HeaderMap, key: axum::http::header::HeaderName, needle: &str) -> bool {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains(needle))
        .unwrap_or(false)
}

fn maybe_decompress(headers: &HeaderMap, body: Bytes) -> Result<Vec<u8>, FheError> {
    if header_contains(headers, CONTENT_ENCODING, "gzip") {
        let mut decoder = GzDecoder::new(body.as_ref());
        let mut decoded = Vec::new();
        decoder.read_to_end(&mut decoded)?;
        Ok(decoded)
    } else {
        Ok(body.to_vec())
    }
}

fn maybe_compress(headers: &HeaderMap, payload: Vec<u8>) -> Result<(Vec<u8>, bool), FheError> {
    if header_contains(headers, ACCEPT_ENCODING, "gzip") {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&payload)?;
        let compressed = encoder.finish()?;
        Ok((compressed, true))
    } else {
        Ok((payload, false))
    }
}

pub fn decode_msgpack<T: DeserializeOwned>(
    headers: &HeaderMap,
    body: Bytes,
) -> Result<T, FheError> {
    let raw = maybe_decompress(headers, body)?;
    let parsed = rmp_serde::from_slice(&raw)?;
    Ok(parsed)
}

pub fn encode_msgpack<T: Serialize>(
    headers: &HeaderMap,
    payload: &T,
) -> Result<Response, FheError> {
    let encoded = rmp_serde::to_vec_named(payload)?;
    let (body, is_gzipped) = maybe_compress(headers, encoded)?;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/msgpack"),
    );
    if is_gzipped {
        response_headers.insert(CONTENT_ENCODING, HeaderValue::from_static("gzip"));
    }

    Ok((StatusCode::OK, response_headers, body).into_response())
}

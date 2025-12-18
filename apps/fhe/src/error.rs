//! Error types for FHE operations

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
#[allow(dead_code)]
pub enum FheError {
    #[error("Key not found: {0}")]
    KeyNotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Encode error: {0}")]
    Encode(#[from] bincode::error::EncodeError),

    #[error("Decode error: {0}")]
    Decode(#[from] bincode::error::DecodeError),

    #[error("Base64 decode error: {0}")]
    Base64Decode(#[from] base64::DecodeError),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for FheError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            FheError::KeyNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            FheError::InvalidInput(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Encode(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Decode(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Base64Decode(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = Json(json!({
            "error": message
        }));

        (status, body).into_response()
    }
}

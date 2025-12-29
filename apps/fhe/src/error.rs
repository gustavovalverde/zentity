//! Error types for FHE operations

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FheError {
    #[error("Key not found: {0}")]
    KeyNotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Bincode error: {0}")]
    Bincode(#[from] bincode::Error),

    #[error("Base64 decode error: {0}")]
    Base64Decode(#[from] base64::DecodeError),

    #[error("TFHE error: {0}")]
    Tfhe(String),

    #[error("Internal error: {0}")]
    #[allow(dead_code)] // Reserved for future internal error handling
    Internal(String),
}

impl IntoResponse for FheError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            FheError::KeyNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            FheError::InvalidInput(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Bincode(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Base64Decode(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Tfhe(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            FheError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = Json(json!({
            "error": message
        }));

        (status, body).into_response()
    }
}

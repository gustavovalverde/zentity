//! Error types for the signer service.
//!
//! All errors implement `ResponseError` for Actix-web integration,
//! converting domain errors into appropriate HTTP status codes.

use actix_web::{HttpResponse, ResponseError, http::StatusCode};
use serde::Serialize;
use thiserror::Error;

/// Service error type with structured error responses.
#[derive(Error, Debug)]
pub enum SignerError {
    // Session errors
    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Session expired: {0}")]
    SessionExpired(String),

    #[error("Invalid session state: expected {expected}, got {actual}")]
    InvalidSessionState { expected: String, actual: String },

    // Participant errors
    #[error("Invalid participant: {0}")]
    InvalidParticipant(String),

    #[error("Participant already submitted: {0}")]
    ParticipantAlreadySubmitted(String),

    #[error("Duplicate commitment value detected")]
    DuplicateCommitment,

    #[error("Missing participants: {0:?}")]
    MissingParticipants(Vec<String>),

    // DKG errors
    #[error("DKG failed: {0}")]
    DkgFailed(String),

    #[error("Invalid DKG package: {0}")]
    InvalidDkgPackage(String),

    // Signing errors
    #[error("Signing failed: {0}")]
    SigningFailed(String),

    #[error("Insufficient signatures: need {needed}, have {have}")]
    InsufficientSignatures { needed: usize, have: usize },

    #[error("Aggregation failed: {0}")]
    AggregationFailed(String),

    #[error("Invalid signature share from participant(s): {culprits:?}")]
    InvalidSignatureShare { culprits: Vec<u16> },

    #[error("Nonces already exist for session {session_id} and group {group_pubkey}")]
    NoncesAlreadyExist {
        session_id: String,
        group_pubkey: String,
    },

    // Key share errors
    #[error("Key share not found: {0}")]
    KeyShareNotFound(String),

    #[error("Key share decryption failed: {0}")]
    KeyShareDecryptionFailed(String),

    // Authentication/authorization errors
    #[error("Unauthorized")]
    Unauthorized,

    #[error("Invalid guardian assertion: {0}")]
    InvalidGuardianAssertion(String),

    #[error("Guardian assertion expired")]
    GuardianAssertionExpired,

    #[error("Guardian not authorized for this session")]
    GuardianNotAuthorized,

    // Crypto errors
    #[error("HPKE encryption failed: {0}")]
    HpkeEncryptionFailed(String),

    #[error("HPKE decryption failed: {0}")]
    HpkeDecryptionFailed(String),

    #[error("Invalid signature: {0}")]
    InvalidSignature(String),

    // Storage errors
    #[error("Storage error: {0}")]
    Storage(String),

    // Signer communication errors
    #[error("Signer unreachable: {0}")]
    SignerUnreachable(String),

    #[error("Signer error: {0}")]
    SignerError(String),

    // Input validation errors
    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Invalid threshold: t={threshold} must be <= n={total}")]
    InvalidThreshold { threshold: u16, total: u16 },

    // Serialization errors
    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Deserialization error: {0}")]
    Deserialization(String),

    // Rate limiting
    #[error("Rate limit exceeded: {0}")]
    RateLimitExceeded(String),

    // TLS errors
    #[error("TLS configuration error: {0}")]
    TlsConfig(String),

    // Internal errors
    #[error("Internal error: {0}")]
    Internal(String),
}

/// JSON error response body.
#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

impl SignerError {
    /// Get the error code for structured error responses.
    fn error_code(&self) -> Option<&'static str> {
        match self {
            Self::SessionNotFound(_) => Some("SESSION_NOT_FOUND"),
            Self::SessionExpired(_) => Some("SESSION_EXPIRED"),
            Self::InvalidSessionState { .. } => Some("INVALID_SESSION_STATE"),
            Self::InvalidParticipant(_) => Some("INVALID_PARTICIPANT"),
            Self::ParticipantAlreadySubmitted(_) => Some("PARTICIPANT_ALREADY_SUBMITTED"),
            Self::DuplicateCommitment => Some("DUPLICATE_COMMITMENT"),
            Self::MissingParticipants(_) => Some("MISSING_PARTICIPANTS"),
            Self::DkgFailed(_) => Some("DKG_FAILED"),
            Self::InvalidDkgPackage(_) => Some("INVALID_DKG_PACKAGE"),
            Self::SigningFailed(_) => Some("SIGNING_FAILED"),
            Self::InsufficientSignatures { .. } => Some("INSUFFICIENT_SIGNATURES"),
            Self::AggregationFailed(_) => Some("AGGREGATION_FAILED"),
            Self::InvalidSignatureShare { .. } => Some("INVALID_SIGNATURE_SHARE"),
            Self::NoncesAlreadyExist { .. } => Some("NONCES_ALREADY_EXIST"),
            Self::KeyShareNotFound(_) => Some("KEY_SHARE_NOT_FOUND"),
            Self::KeyShareDecryptionFailed(_) => Some("KEY_SHARE_DECRYPTION_FAILED"),
            Self::Unauthorized => Some("UNAUTHORIZED"),
            Self::InvalidGuardianAssertion(_) => Some("INVALID_GUARDIAN_ASSERTION"),
            Self::GuardianAssertionExpired => Some("GUARDIAN_ASSERTION_EXPIRED"),
            Self::GuardianNotAuthorized => Some("GUARDIAN_NOT_AUTHORIZED"),
            Self::HpkeEncryptionFailed(_) => Some("HPKE_ENCRYPTION_FAILED"),
            Self::HpkeDecryptionFailed(_) => Some("HPKE_DECRYPTION_FAILED"),
            Self::InvalidSignature(_) => Some("INVALID_SIGNATURE"),
            Self::Storage(_) => Some("STORAGE_ERROR"),
            Self::SignerUnreachable(_) => Some("SIGNER_UNREACHABLE"),
            Self::SignerError(_) => Some("SIGNER_ERROR"),
            Self::InvalidInput(_) => Some("INVALID_INPUT"),
            Self::InvalidThreshold { .. } => Some("INVALID_THRESHOLD"),
            Self::Serialization(_) => Some("SERIALIZATION_ERROR"),
            Self::Deserialization(_) => Some("DESERIALIZATION_ERROR"),
            Self::RateLimitExceeded(_) => Some("RATE_LIMIT_EXCEEDED"),
            Self::TlsConfig(_) => Some("TLS_CONFIG_ERROR"),
            Self::Internal(_) => None, // Don't expose internal error codes
        }
    }
}

impl ResponseError for SignerError {
    fn status_code(&self) -> StatusCode {
        match self {
            // 400 Bad Request - Client errors
            Self::InvalidInput(_)
            | Self::InvalidThreshold { .. }
            | Self::InvalidDkgPackage(_)
            | Self::InvalidParticipant(_)
            | Self::ParticipantAlreadySubmitted(_)
            | Self::DuplicateCommitment
            | Self::Serialization(_)
            | Self::Deserialization(_) => StatusCode::BAD_REQUEST,

            // 401 Unauthorized
            Self::Unauthorized
            | Self::InvalidGuardianAssertion(_)
            | Self::GuardianAssertionExpired => StatusCode::UNAUTHORIZED,

            // 403 Forbidden
            Self::GuardianNotAuthorized => StatusCode::FORBIDDEN,

            // 404 Not Found
            Self::SessionNotFound(_) | Self::KeyShareNotFound(_) => StatusCode::NOT_FOUND,

            // 409 Conflict - State conflicts
            Self::InvalidSessionState { .. }
            | Self::SessionExpired(_)
            | Self::NoncesAlreadyExist { .. } => StatusCode::CONFLICT,

            // 422 Unprocessable Entity - Business logic errors
            Self::DkgFailed(_)
            | Self::SigningFailed(_)
            | Self::AggregationFailed(_)
            | Self::InvalidSignatureShare { .. }
            | Self::InsufficientSignatures { .. }
            | Self::MissingParticipants(_)
            | Self::InvalidSignature(_) => StatusCode::UNPROCESSABLE_ENTITY,

            // 429 Too Many Requests
            Self::RateLimitExceeded(_) => StatusCode::TOO_MANY_REQUESTS,

            // 502 Bad Gateway - Downstream errors
            Self::SignerUnreachable(_) | Self::SignerError(_) => StatusCode::BAD_GATEWAY,

            // 500 Internal Server Error - Everything else
            Self::HpkeEncryptionFailed(_)
            | Self::HpkeDecryptionFailed(_)
            | Self::KeyShareDecryptionFailed(_)
            | Self::Storage(_)
            | Self::TlsConfig(_)
            | Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> HttpResponse {
        let body = ErrorResponse {
            error: self.to_string(),
            code: self.error_code().map(String::from),
        };

        HttpResponse::build(self.status_code()).json(body)
    }
}

// Conversion from common error types

impl From<std::io::Error> for SignerError {
    fn from(err: std::io::Error) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<serde_json::Error> for SignerError {
    fn from(err: serde_json::Error) -> Self {
        if err.is_data() || err.is_syntax() || err.is_eof() {
            Self::Deserialization(err.to_string())
        } else {
            Self::Serialization(err.to_string())
        }
    }
}

impl From<redb::Error> for SignerError {
    fn from(err: redb::Error) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<redb::DatabaseError> for SignerError {
    fn from(err: redb::DatabaseError) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<redb::TableError> for SignerError {
    fn from(err: redb::TableError) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<redb::TransactionError> for SignerError {
    fn from(err: redb::TransactionError) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<redb::CommitError> for SignerError {
    fn from(err: redb::CommitError) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<redb::StorageError> for SignerError {
    fn from(err: redb::StorageError) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<reqwest::Error> for SignerError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::SignerUnreachable(format!("Request timed out: {err}"))
        } else if err.is_connect() {
            Self::SignerUnreachable(format!("Connection failed: {err}"))
        } else {
            Self::SignerError(err.to_string())
        }
    }
}

impl From<jsonwebtoken::errors::Error> for SignerError {
    fn from(err: jsonwebtoken::errors::Error) -> Self {
        use jsonwebtoken::errors::ErrorKind;
        match err.kind() {
            ErrorKind::ExpiredSignature => Self::GuardianAssertionExpired,
            // All other JWT errors are treated as invalid assertions
            _ => Self::InvalidGuardianAssertion(err.to_string()),
        }
    }
}

/// Result type alias for signer operations.
pub type SignerResult<T> = Result<T, SignerError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_status_codes() {
        assert_eq!(
            SignerError::InvalidInput("test".to_string()).status_code(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            SignerError::Unauthorized.status_code(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            SignerError::SessionNotFound("test".to_string()).status_code(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            SignerError::RateLimitExceeded("test".to_string()).status_code(),
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[test]
    fn test_error_codes() {
        assert_eq!(
            SignerError::SessionNotFound("test".to_string()).error_code(),
            Some("SESSION_NOT_FOUND")
        );
        assert_eq!(SignerError::Internal("test".to_string()).error_code(), None);
    }
}

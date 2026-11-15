//! MessagePack request and response bodies.
//!
//! Gzip is not handled here. `app::build_router` decompresses gzip request
//! bodies and compresses responses for clients that accept gzip, so the body
//! limit applies to the decompressed bytes.

use axum::{
    body::Bytes,
    extract::{FromRequest, Request},
    http::{header::CONTENT_TYPE, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{de::DeserializeOwned, Serialize};

use crate::error::FheError;

/// A MessagePack body, used as both request extractor and response.
pub struct MsgPack<T>(pub T);

impl<S, T> FromRequest<S> for MsgPack<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    type Rejection = Response;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let bytes = Bytes::from_request(req, state).await.map_err(|rejection| {
            match rejection.status() {
                // A corrupt gzip stream fails here; report it in the service's error format.
                StatusCode::BAD_REQUEST => {
                    FheError::InvalidInput(rejection.body_text()).into_response()
                }
                // Keep the 413 for bodies over the limit.
                _ => rejection.into_response(),
            }
        })?;
        tracing::Span::current().record("request_bytes", bytes.len());

        let value =
            rmp_serde::from_slice(&bytes).map_err(|error| FheError::from(error).into_response())?;
        Ok(Self(value))
    }
}

impl<T: Serialize> IntoResponse for MsgPack<T> {
    fn into_response(self) -> Response {
        match rmp_serde::to_vec_named(&self.0) {
            Ok(body) => (
                [(
                    CONTENT_TYPE,
                    HeaderValue::from_static("application/msgpack"),
                )],
                body,
            )
                .into_response(),
            Err(error) => FheError::from(error).into_response(),
        }
    }
}

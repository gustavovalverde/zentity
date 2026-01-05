//! Key registration endpoint HTTP tests.
//!
//! Tests the /keys/register endpoint with various valid and invalid inputs.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde::Deserialize;
use tower::ServiceExt;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterKeyResponse {
    key_id: String,
}

// ============================================================================
// Happy Path Tests
// ============================================================================

/// Register key returns 200 with valid server key.
#[tokio::test]
async fn register_key_returns_uuid() {
    let app = http::test_app();

    // Get a valid server key from test utilities
    let (_, _, _) = common::get_test_keys(); // This registers a key internally
    let server_key = get_server_key_bytes();
    let public_key = common::get_public_key_bytes();

    let body = http::fixtures::register_key_request(&server_key, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: RegisterKeyResponse = http::parse_msgpack_body(response).await;

    // Verify it's a valid UUID
    let key_id = body.key_id;
    assert!(
        Uuid::parse_str(&key_id).is_ok(),
        "keyId should be a valid UUID"
    );
}

/// Multiple key registrations return unique UUIDs.
#[tokio::test]
async fn register_key_unique_ids() {
    let server_key = get_server_key_bytes();
    let public_key = common::get_public_key_bytes();
    let mut key_ids = Vec::new();

    for _ in 0..3 {
        let app = http::test_app();
        let body = http::fixtures::register_key_request(&server_key, &public_key);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/keys/register")
                    .header("content-type", "application/msgpack")
                    .body(Body::from(http::msgpack_body(&body)))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body: RegisterKeyResponse = http::parse_msgpack_body(response).await;
        key_ids.push(body.key_id);
    }

    // All key IDs should be unique
    let unique_count = key_ids
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len();
    assert_eq!(unique_count, key_ids.len(), "All key IDs should be unique");
}

// ============================================================================
// Invalid Key Byte Tests
// ============================================================================

/// Invalid server key bytes return 400.
#[tokio::test]
async fn register_key_invalid_bytes() {
    let app = http::test_app();

    let body =
        http::fixtures::register_key_request(b"not-valid-key", &common::get_public_key_bytes());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Invalid bincode content returns 400.
#[tokio::test]
async fn register_key_invalid_bincode() {
    let app = http::test_app();

    let body =
        http::fixtures::register_key_request(b"hello world", &common::get_public_key_bytes());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Empty server key bytes return 400.
#[tokio::test]
async fn register_key_empty_string() {
    let app = http::test_app();

    let body = http::fixtures::register_key_request(&[], &common::get_public_key_bytes());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ============================================================================
// Missing/Malformed Request Body Tests
// ============================================================================

/// Missing serverKey field returns 400.
#[tokio::test]
async fn register_key_missing_field() {
    let app = http::test_app();

    let body = serde_json::json!({
        "publicKey": common::get_public_key_bytes()
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    // Axum returns 422 for missing required fields
    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY,
        "Expected 400 or 422, got {}",
        response.status()
    );
}

/// Null serverKey field returns 400/422.
#[tokio::test]
async fn register_key_null_field() {
    let app = http::test_app();

    let body = serde_json::json!({
        "serverKey": null,
        "publicKey": common::get_public_key_bytes()
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY,
        "Expected 400 or 422, got {}",
        response.status()
    );
}

/// Wrong type for serverKey (number instead of string) returns 400/422.
#[tokio::test]
async fn register_key_wrong_type() {
    let app = http::test_app();

    let body = serde_json::json!({
        "serverKey": 12345,
        "publicKey": common::get_public_key_bytes()
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY,
        "Expected 400 or 422, got {}",
        response.status()
    );
}

/// Malformed JSON returns 400.
#[tokio::test]
async fn register_key_malformed_json() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::fixtures::malformed_json()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Empty body returns 400.
#[tokio::test]
async fn register_key_empty_body() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Invalid msgpack payload returns 400.
#[tokio::test]
async fn register_key_invalid_msgpack() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "text/plain")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Missing content type header with invalid payload returns 400.
#[tokio::test]
async fn register_key_missing_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                // No content-type header
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// GET method returns 405.
#[tokio::test]
async fn register_key_rejects_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/keys/register")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

// ============================================================================
// Error Response Format Tests
// ============================================================================

/// Error response has correct JSON format.
#[tokio::test]
async fn register_key_error_format() {
    let app = http::test_app();

    let body =
        http::fixtures::register_key_request(b"invalid-key", &common::get_public_key_bytes());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let json = http::parse_json_body(response).await;
    assert!(
        json["error"].is_string(),
        "Error response should have 'error' field"
    );
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get a valid server key for testing (serialized bytes).
/// Uses the cached key from common module for performance.
fn get_server_key_bytes() -> Vec<u8> {
    common::get_server_key_bytes()
}

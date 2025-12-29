//! Key registration endpoint HTTP tests.
//!
//! Tests the /keys/register endpoint with various valid and invalid inputs.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;
use uuid::Uuid;

// ============================================================================
// Happy Path Tests
// ============================================================================

/// Register key returns 200 with valid server key.
#[tokio::test]
async fn register_key_returns_uuid() {
    let app = http::test_app();

    // Get a valid server key from test utilities
    let (_, _, _) = common::get_test_keys(); // This registers a key internally
    let server_key_b64 = get_server_key_b64();

    let body = http::fixtures::register_key_request(&server_key_b64);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_json_body(response).await;
    assert!(json["keyId"].is_string());

    // Verify it's a valid UUID
    let key_id = json["keyId"].as_str().unwrap();
    assert!(
        Uuid::parse_str(key_id).is_ok(),
        "keyId should be a valid UUID"
    );
}

/// Multiple key registrations return unique UUIDs.
#[tokio::test]
async fn register_key_unique_ids() {
    let server_key_b64 = get_server_key_b64();
    let mut key_ids = Vec::new();

    for _ in 0..3 {
        let app = http::test_app();
        let body = http::fixtures::register_key_request(&server_key_b64);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/keys/register")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let json = http::parse_json_body(response).await;
        key_ids.push(json["keyId"].as_str().unwrap().to_string());
    }

    // All key IDs should be unique
    let unique_count = key_ids
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len();
    assert_eq!(unique_count, key_ids.len(), "All key IDs should be unique");
}

// ============================================================================
// Invalid Base64 Tests
// ============================================================================

/// Invalid base64 string returns 400.
#[tokio::test]
async fn register_key_invalid_base64() {
    let app = http::test_app();

    let body = serde_json::json!({
        "serverKey": "not-valid-base64!!!"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Valid base64 but invalid bincode content returns 400.
#[tokio::test]
async fn register_key_invalid_bincode() {
    let app = http::test_app();

    // "Hello World!" in base64 - valid base64 but not a server key
    let body = serde_json::json!({
        "serverKey": "SGVsbG8gV29ybGQh"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Empty base64 string returns 400.
#[tokio::test]
async fn register_key_empty_string() {
    let app = http::test_app();

    let body = serde_json::json!({
        "serverKey": ""
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
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

    let body = http::fixtures::empty_object();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
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

    let body = http::fixtures::with_null_field("serverKey");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
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

    let body = http::fixtures::with_number_instead_of_string("serverKey");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
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
                .header("content-type", "application/json")
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
                .header("content-type", "application/json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Wrong content type returns 415.
#[tokio::test]
async fn register_key_wrong_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "text/plain")
                .body(Body::from(r#"{"serverKey": "test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

/// Missing content type header returns 415.
#[tokio::test]
async fn register_key_missing_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                // No content-type header
                .body(Body::from(r#"{"serverKey": "test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
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

    let body = serde_json::json!({
        "serverKey": "invalid-base64!!!"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
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

/// Get a valid server key for testing (base64 encoded).
/// Uses the cached key from common module for performance.
fn get_server_key_b64() -> String {
    common::get_server_key_b64()
}

//! Error response format and status code tests.
//!
//! Validates that FheError variants map to correct HTTP status codes
//! and that error responses have the expected JSON format.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde::Deserialize;
use tower::ServiceExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptBirthYearOffsetResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
}

// ============================================================================
// Error Response Format Tests
// ============================================================================

/// KeyNotFound error returns 404 with correct format.
#[tokio::test]
async fn error_format_key_not_found() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt first
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &key_id);
    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_body: EncryptBirthYearOffsetResponse =
        http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_body.ciphertext;

    // Use non-existent key ID
    let verify_body = http::fixtures::with_invalid_key_id(&ciphertext);

    let app = http::test_app();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let json = http::parse_json_body(response).await;
    assert!(json["error"].is_string());
    let error_msg = json["error"].as_str().unwrap();
    assert!(
        error_msg.contains("Key not found"),
        "Error message should mention 'Key not found', got: {}",
        error_msg
    );
}

/// InvalidInput error returns 400 with correct format.
#[tokio::test]
async fn error_format_invalid_input() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Use out-of-range birth year offset
    let body = http::fixtures::encrypt_birth_year_offset_request(256, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let json = http::parse_json_body(response).await;
    assert!(json["error"].is_string());
    let error_msg = json["error"].as_str().unwrap();
    assert!(
        error_msg.contains("Invalid input"),
        "Error message should mention 'Invalid input', got: {}",
        error_msg
    );
}

/// Bincode error returns 400 with correct format.
#[tokio::test]
async fn error_format_bincode_error() {
    let app = http::test_app();

    let body = http::fixtures::register_key_request(
        b"not a valid server key",
        &common::get_public_key_bytes(),
    );

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
    assert!(json["error"].is_string());
}

// ============================================================================
// Msgpack Parse Error Tests
// ============================================================================

/// Invalid msgpack returns 400.
#[tokio::test]
async fn msgpack_parse_error() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/msgpack")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Empty body returns 400.
#[tokio::test]
async fn empty_body_error() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/msgpack")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ============================================================================
// Content Type Error Tests
// ============================================================================

/// Missing content type with invalid payload returns 400.
#[tokio::test]
async fn missing_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Wrong content type returns 400 when payload is not msgpack.
#[tokio::test]
async fn wrong_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "text/plain")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// text/html content type returns 400 when payload is not msgpack.
#[tokio::test]
async fn html_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "text/html")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ============================================================================
// Status Code Mapping Tests
// ============================================================================

/// Verify each error type maps to expected status code.
#[tokio::test]
async fn status_codes_mapping() {
    // KeyNotFound -> 404
    {
        let app = http::test_app();
        let key_id = common::get_registered_key_id();

        let body = http::fixtures::with_corrupted_ciphertext(&key_id);
        let body = http::fixtures::with_invalid_key_id(&body.ciphertext);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/verify-age-offset")
                    .header("content-type", "application/msgpack")
                    .body(Body::from(http::msgpack_body(&body)))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "KeyNotFound should map to 404"
        );
    }

    // InvalidInput -> 400
    {
        let app = http::test_app();
        let key_id = common::get_registered_key_id();

        let body = http::fixtures::encrypt_birth_year_offset_request(256, &key_id);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/encrypt-birth-year-offset")
                    .header("content-type", "application/msgpack")
                    .body(Body::from(http::msgpack_body(&body)))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "InvalidInput should map to 400"
        );
    }

    // Bincode -> 400
    {
        let app = http::test_app();

        let body = http::fixtures::register_key_request(
            b"not a valid server key",
            &common::get_public_key_bytes(),
        );

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

        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "Bincode should map to 400"
        );
    }
}

// ============================================================================
// Error Response Structure Tests
// ============================================================================

/// All error responses have consistent JSON structure.
#[tokio::test]
async fn error_response_structure() {
    let key_id = common::get_registered_key_id();
    let error_cases = vec![
        (
            "/encrypt-birth-year-offset",
            serde_json::json!({
                "birthYearOffset": 1000,
                "keyId": key_id.clone()
            }),
        ),
        (
            "/encrypt-birth-year-offset",
            serde_json::json!({
                "birthYearOffset": 100,
                "keyId": "00000000-0000-0000-0000-000000000000"
            }),
        ),
        (
            "/verify-age-offset",
            serde_json::json!({
                "ciphertext": "not-a-valid-ciphertext",
                "currentYear": 2025,
                "minAge": 18,
                "keyId": key_id.clone()
            }),
        ),
    ];

    for (uri, body) in error_cases {
        let app = http::test_app();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header("content-type", "application/msgpack")
                    .body(Body::from(http::msgpack_body(&body)))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Errors should be 400 or 404 depending on failure type
        assert!(
            response.status() == StatusCode::BAD_REQUEST
                || response.status() == StatusCode::NOT_FOUND
        );

        let json = http::parse_json_body(response).await;

        // All should have "error" field
        assert!(
            json["error"].is_string(),
            "Error response should have 'error' string field"
        );

        // Error message should not be empty
        let error_msg = json["error"].as_str().unwrap();
        assert!(!error_msg.is_empty(), "Error message should not be empty");
    }
}

//! Batch encryption endpoint HTTP tests.
//!
//! Tests the /encrypt-batch endpoint.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

/// Batch encryption returns ciphertexts for provided fields.
#[tokio::test]
async fn encrypt_batch_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "keyId": key_id,
        "birthYearOffset": 90,
        "countryCode": 840,
        "complianceLevel": 3,
        "livenessScore": 0.85
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-batch")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_msgpack_body(response).await;
    assert!(json["birthYearOffsetCiphertext"].is_string());
    assert!(json["countryCodeCiphertext"].is_string());
    assert!(json["complianceLevelCiphertext"].is_string());
    assert!(json["livenessScoreCiphertext"].is_string());
}

/// Empty batch payload returns 400.
#[tokio::test]
async fn encrypt_batch_requires_payload() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "keyId": key_id
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-batch")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Non-existent key id returns 404.
#[tokio::test]
async fn encrypt_batch_invalid_key() {
    let app = http::test_app();

    let body = serde_json::json!({
        "keyId": "00000000-0000-0000-0000-000000000000",
        "birthYearOffset": 90
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-batch")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

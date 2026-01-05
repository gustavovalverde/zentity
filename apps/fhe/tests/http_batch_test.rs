//! Batch encryption endpoint HTTP tests.
//!
//! Tests the /encrypt-batch endpoint.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde::Deserialize;
use serde_bytes::ByteBuf;
use tower::ServiceExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptBatchResponse {
    birth_year_offset_ciphertext: Option<ByteBuf>,
    country_code_ciphertext: Option<ByteBuf>,
    compliance_level_ciphertext: Option<ByteBuf>,
    liveness_score_ciphertext: Option<ByteBuf>,
}

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

    let body: EncryptBatchResponse = http::parse_msgpack_body(response).await;
    assert!(body.birth_year_offset_ciphertext.is_some());
    assert!(body.country_code_ciphertext.is_some());
    assert!(body.compliance_level_ciphertext.is_some());
    assert!(body.liveness_score_ciphertext.is_some());
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

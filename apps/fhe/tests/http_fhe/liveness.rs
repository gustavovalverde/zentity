//! Liveness threshold endpoint HTTP tests.
//!
//! Tests the /verify-liveness-threshold endpoint. Ciphertexts under test come from /encrypt-batch.
//! Includes full roundtrip integration tests with decryption.

use tfhe::prelude::FheDecrypt;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde::Deserialize;
use tower::ServiceExt;

use crate::{common, http};
use http::fixtures::liveness_boundaries::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyLivenessThresholdResponse {
    #[serde(with = "serde_bytes")]
    passes_ciphertext: Vec<u8>,
    threshold: f64,
}

// ============================================================================
// Verify Liveness Threshold - Happy Path Tests
// ============================================================================

/// Verify liveness threshold returns 200 with valid inputs.
#[tokio::test]
async fn verify_liveness_threshold_success() {
    let key_id = common::get_registered_key_id();

    let ciphertext = http::encrypt_attribute("livenessScore", 0.9, &key_id).await;

    let verify_body =
        http::fixtures::verify_liveness_threshold_request(&ciphertext, TYPICAL_THRESHOLD, &key_id);

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);

    let body: VerifyLivenessThresholdResponse = http::parse_msgpack_body(verify_response).await;
    assert!(!body.passes_ciphertext.is_empty());
    assert_eq!(body.threshold, TYPICAL_THRESHOLD);
}

// ============================================================================
// Verify Liveness Threshold - Error Tests
// ============================================================================

/// Non-existent key ID returns 404.
#[tokio::test]
async fn verify_liveness_threshold_invalid_key_id() {
    let key_id = common::get_registered_key_id();

    let ciphertext = http::encrypt_attribute("livenessScore", 0.85, &key_id).await;

    let verify_body = http::fixtures::VerifyLivenessThresholdRequest {
        ciphertext: ciphertext.clone(),
        threshold: 0.8,
        key_id: "00000000-0000-0000-0000-000000000000".to_string(),
    };

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::NOT_FOUND);
}

/// Threshold over max (1.5) returns 400.
#[tokio::test]
async fn verify_liveness_threshold_over_max() {
    let key_id = common::get_registered_key_id();

    let ciphertext = http::encrypt_attribute("livenessScore", 0.85, &key_id).await;

    let verify_body = http::fixtures::VerifyLivenessThresholdRequest {
        ciphertext: ciphertext.clone(),
        threshold: 1.5,
        key_id: key_id.clone(),
    };

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Negative threshold returns 400.
#[tokio::test]
async fn verify_liveness_threshold_negative() {
    let key_id = common::get_registered_key_id();

    let ciphertext = http::encrypt_attribute("livenessScore", 0.85, &key_id).await;

    let verify_body = http::fixtures::VerifyLivenessThresholdRequest {
        ciphertext: ciphertext.clone(),
        threshold: -0.1,
        key_id: key_id.clone(),
    };

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Corrupted ciphertext returns 400.
#[tokio::test]
async fn verify_liveness_threshold_invalid_ciphertext() {
    let app = http::test_app();
    let (_, _, key_id) = common::get_test_keys();

    let verify_body = http::fixtures::VerifyLivenessThresholdRequest {
        ciphertext: b"this is not a valid ciphertext".to_vec(),
        threshold: 0.8,
        key_id,
    };

    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Missing required fields returns 400/422.
#[tokio::test]
async fn verify_liveness_threshold_missing_fields() {
    let app = http::test_app();

    let verify_body = http::fixtures::empty_object();

    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        verify_response.status() == StatusCode::BAD_REQUEST
            || verify_response.status() == StatusCode::UNPROCESSABLE_ENTITY
    );
}

// ============================================================================
// Full Roundtrip Integration Tests (with decryption)
// ============================================================================

/// Roundtrip test: score passes threshold (0.9 >= 0.8).
#[tokio::test]
async fn liveness_roundtrip_passes_threshold() {
    use tfhe::FheBool;

    let (client_key, _, key_id) = common::get_test_keys();

    let ciphertext = http::encrypt_attribute("livenessScore", 0.9, &key_id).await;

    let verify_body = http::fixtures::verify_liveness_threshold_request(&ciphertext, 0.8, &key_id);

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);

    let body: VerifyLivenessThresholdResponse = http::parse_msgpack_body(verify_response).await;
    let passes_ciphertext = body.passes_ciphertext;

    let passes_encrypted: FheBool =
        fhe_service::crypto::decode_tfhe_binary(&passes_ciphertext).unwrap();
    let passes: bool = passes_encrypted.decrypt(&client_key);

    assert!(passes, "Score 0.9 should pass threshold 0.8");
}

/// Roundtrip test: score fails threshold (0.7 < 0.8).
#[tokio::test]
async fn liveness_roundtrip_fails_threshold() {
    use tfhe::FheBool;

    let (client_key, _, key_id) = common::get_test_keys();

    let ciphertext = http::encrypt_attribute("livenessScore", 0.7, &key_id).await;

    let verify_body = http::fixtures::verify_liveness_threshold_request(&ciphertext, 0.8, &key_id);

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);

    let body: VerifyLivenessThresholdResponse = http::parse_msgpack_body(verify_response).await;

    let passes_encrypted: FheBool =
        fhe_service::crypto::decode_tfhe_binary(&body.passes_ciphertext).unwrap();
    let passes: bool = passes_encrypted.decrypt(&client_key);

    assert!(!passes, "Score 0.7 should fail threshold 0.8");
}

/// Roundtrip test: exact threshold boundary (0.8 >= 0.8).
#[tokio::test]
async fn liveness_roundtrip_exact_threshold() {
    use tfhe::FheBool;

    let (client_key, _, key_id) = common::get_test_keys();

    let ciphertext = http::encrypt_attribute("livenessScore", 0.8, &key_id).await;

    let verify_body = http::fixtures::verify_liveness_threshold_request(&ciphertext, 0.8, &key_id);

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-liveness-threshold")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);

    let body: VerifyLivenessThresholdResponse = http::parse_msgpack_body(verify_response).await;

    let passes_encrypted: FheBool =
        fhe_service::crypto::decode_tfhe_binary(&body.passes_ciphertext).unwrap();
    let passes: bool = passes_encrypted.decrypt(&client_key);

    assert!(passes, "Score 0.8 should pass threshold 0.8 (>=)");
}

// ============================================================================
// HTTP Method Tests
// ============================================================================

/// GET on verify endpoint returns 405.
#[tokio::test]
async fn verify_liveness_threshold_rejects_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/verify-liveness-threshold")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

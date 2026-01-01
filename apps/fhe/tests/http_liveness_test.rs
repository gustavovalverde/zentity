//! Liveness score endpoint HTTP tests.
//!
//! Tests the /encrypt-liveness and /verify-liveness-threshold endpoints.
//! Includes full roundtrip integration tests with decryption.

mod common;
mod http;

use tfhe::prelude::FheDecrypt;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http::fixtures::liveness_boundaries::*;
use tower::ServiceExt;

// ============================================================================
// Encrypt Liveness Score - Happy Path Tests
// ============================================================================

/// Encrypt liveness score returns 200 with valid inputs.
#[tokio::test]
async fn encrypt_liveness_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_liveness_request(TYPICAL_SCORE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_msgpack_body(response).await;
    assert!(json["ciphertext"].is_string());
    assert!(!json["ciphertext"].as_str().unwrap().is_empty());
    // Score is echoed back for confirmation
    assert_eq!(json["score"], TYPICAL_SCORE);
}

/// Encrypt with minimum score (0.0) succeeds.
#[tokio::test]
async fn encrypt_liveness_boundary_zero() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_liveness_request(MIN_SCORE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_msgpack_body(response).await;
    assert_eq!(json["score"], MIN_SCORE);
}

/// Encrypt with maximum score (1.0) succeeds.
#[tokio::test]
async fn encrypt_liveness_boundary_one() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_liveness_request(MAX_SCORE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_msgpack_body(response).await;
    assert_eq!(json["score"], MAX_SCORE);
}

/// Encrypt with precision score preserves 4 decimal places.
#[tokio::test]
async fn encrypt_liveness_precision() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_liveness_request(PRECISION_SCORE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_msgpack_body(response).await;
    // Score echoed should match input (within precision)
    let echoed_score = json["score"].as_f64().unwrap();
    assert!(
        (echoed_score - PRECISION_SCORE).abs() < 0.0001,
        "Score precision not preserved: {} vs {}",
        echoed_score,
        PRECISION_SCORE
    );
}

// ============================================================================
// Encrypt Liveness Score - Validation Error Tests
// ============================================================================

/// Score over max (1.5) returns 400.
#[tokio::test]
async fn encrypt_liveness_over_max() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_liveness_request(OVER_MAX_SCORE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Negative score returns 400.
#[tokio::test]
async fn encrypt_liveness_negative() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_liveness_request(NEGATIVE_SCORE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Invalid key id returns 400.
#[tokio::test]
async fn encrypt_liveness_invalid_key_id() {
    let app = http::test_app();

    let body = serde_json::json!({
        "score": 0.85,
        "keyId": "not-valid-key-id"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

/// Missing fields returns 400/422.
#[tokio::test]
async fn encrypt_liveness_missing_fields() {
    let app = http::test_app();

    let body = http::fixtures::empty_object();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY
    );
}

/// String instead of number for score returns 400/422.
#[tokio::test]
async fn encrypt_liveness_wrong_type() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "score": "not-a-number",
        "keyId": key_id
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY
    );
}

// ============================================================================
// Verify Liveness Threshold - Happy Path Tests
// ============================================================================

/// Verify liveness threshold returns 200 with valid inputs.
#[tokio::test]
async fn verify_liveness_threshold_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // First encrypt a liveness score
    let encrypt_body = http::fixtures::encrypt_liveness_request(0.9, &key_id);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(encrypt_response.status(), StatusCode::OK);
    let encrypt_json = http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Now verify threshold
    let verify_body = http::fixtures::verify_liveness_threshold_request(
        ciphertext,
        TYPICAL_THRESHOLD, // 0.8
        &key_id,
    );

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

    let json = http::parse_msgpack_body(verify_response).await;
    assert!(json["passesCiphertext"].is_string());
    assert!(!json["passesCiphertext"].as_str().unwrap().is_empty());
    // Threshold is echoed back
    assert_eq!(json["threshold"], TYPICAL_THRESHOLD);
}

// ============================================================================
// Verify Liveness Threshold - Error Tests
// ============================================================================

/// Non-existent key ID returns 404.
#[tokio::test]
async fn verify_liveness_threshold_invalid_key_id() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt first
    let encrypt_body = http::fixtures::encrypt_liveness_request(0.85, &key_id);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Try to verify with invalid key ID
    let verify_body = serde_json::json!({
        "ciphertext": ciphertext,
        "threshold": 0.8,
        "keyId": "00000000-0000-0000-0000-000000000000"
    });

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
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt first
    let encrypt_body = http::fixtures::encrypt_liveness_request(0.85, &key_id);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Try to verify with threshold > 1.0
    let verify_body = serde_json::json!({
        "ciphertext": ciphertext,
        "threshold": 1.5,
        "keyId": key_id
    });

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
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt first
    let encrypt_body = http::fixtures::encrypt_liveness_request(0.85, &key_id);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Try to verify with negative threshold
    let verify_body = serde_json::json!({
        "ciphertext": ciphertext,
        "threshold": -0.1,
        "keyId": key_id
    });

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

    // Try to verify with garbage ciphertext
    let verify_body = serde_json::json!({
        "ciphertext": "dGhpcyBpcyBub3QgYSB2YWxpZCBjaXBoZXJ0ZXh0",
        "threshold": 0.8,
        "keyId": key_id
    });

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
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use tfhe::FheBool;

    let app = http::test_app();
    let (client_key, _, key_id) = common::get_test_keys();

    // Encrypt score 0.9
    let encrypt_body = http::fixtures::encrypt_liveness_request(0.9, &key_id);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Verify with threshold 0.8
    let verify_body = http::fixtures::verify_liveness_threshold_request(ciphertext, 0.8, &key_id);

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

    let json = http::parse_msgpack_body(verify_response).await;
    let passes_ciphertext_b64 = json["passesCiphertext"].as_str().unwrap();

    // Decrypt the result
    let passes_bytes = BASE64.decode(passes_ciphertext_b64).unwrap();
    let passes_encrypted: FheBool = bincode::deserialize(&passes_bytes).unwrap();
    let passes: bool = passes_encrypted.decrypt(&client_key);

    assert!(passes, "Score 0.9 should pass threshold 0.8");
}

/// Roundtrip test: score fails threshold (0.7 < 0.8).
#[tokio::test]
async fn liveness_roundtrip_fails_threshold() {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use tfhe::FheBool;

    let app = http::test_app();
    let (client_key, _, key_id) = common::get_test_keys();

    // Encrypt score 0.7
    let encrypt_body = http::fixtures::encrypt_liveness_request(0.7, &key_id);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Verify with threshold 0.8
    let verify_body = http::fixtures::verify_liveness_threshold_request(ciphertext, 0.8, &key_id);

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

    let json = http::parse_msgpack_body(verify_response).await;
    let passes_ciphertext_b64 = json["passesCiphertext"].as_str().unwrap();

    // Decrypt the result
    let passes_bytes = BASE64.decode(passes_ciphertext_b64).unwrap();
    let passes_encrypted: FheBool = bincode::deserialize(&passes_bytes).unwrap();
    let passes: bool = passes_encrypted.decrypt(&client_key);

    assert!(!passes, "Score 0.7 should fail threshold 0.8");
}

/// Roundtrip test: exact threshold boundary (0.8 >= 0.8).
#[tokio::test]
async fn liveness_roundtrip_exact_threshold() {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
    use tfhe::FheBool;

    let app = http::test_app();
    let (client_key, _, key_id) = common::get_test_keys();

    // Encrypt score exactly at threshold
    let encrypt_body = http::fixtures::encrypt_liveness_request(0.8, &key_id);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-liveness")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Verify with same threshold
    let verify_body = http::fixtures::verify_liveness_threshold_request(ciphertext, 0.8, &key_id);

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

    let json = http::parse_msgpack_body(verify_response).await;
    let passes_ciphertext_b64 = json["passesCiphertext"].as_str().unwrap();

    // Decrypt the result
    let passes_bytes = BASE64.decode(passes_ciphertext_b64).unwrap();
    let passes_encrypted: FheBool = bincode::deserialize(&passes_bytes).unwrap();
    let passes: bool = passes_encrypted.decrypt(&client_key);

    assert!(passes, "Score 0.8 should pass threshold 0.8 (>=)");
}

// ============================================================================
// HTTP Method Tests
// ============================================================================

/// GET on encrypt endpoint returns 405.
#[tokio::test]
async fn encrypt_liveness_rejects_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/encrypt-liveness")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

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

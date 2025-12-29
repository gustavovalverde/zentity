//! Age verification endpoint HTTP tests.
//!
//! Tests the /encrypt-birth-year-offset and /verify-age-offset endpoints.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http::fixtures::age_boundaries::*;
use tower::ServiceExt;

// ============================================================================
// Encrypt Birth Year Offset - Happy Path Tests
// ============================================================================

/// Encrypt birth year offset returns 200 with valid inputs.
#[tokio::test]
async fn encrypt_birth_year_offset_success() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_birth_year_offset_request(TYPICAL_OFFSET, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_json_body(response).await;
    assert!(json["ciphertext"].is_string());
    assert!(!json["ciphertext"].as_str().unwrap().is_empty());
}

/// Encrypt with minimum offset (0) succeeds.
#[tokio::test]
async fn encrypt_birth_year_offset_boundary_zero() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_birth_year_offset_request(MIN_OFFSET, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Encrypt with maximum offset (255) succeeds.
#[tokio::test]
async fn encrypt_birth_year_offset_boundary_max() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_birth_year_offset_request(MAX_OFFSET, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

// ============================================================================
// Encrypt Birth Year Offset - Validation Error Tests
// ============================================================================

/// Offset over max (256) returns 400.
#[tokio::test]
async fn encrypt_birth_year_offset_over_max() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_birth_year_offset_request(OVER_MAX_OFFSET, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Invalid public key returns 400.
#[tokio::test]
async fn encrypt_birth_year_offset_invalid_public_key() {
    let app = http::test_app();

    let body = http::fixtures::with_invalid_base64_key();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Valid base64 but invalid key content returns 400.
#[tokio::test]
async fn encrypt_birth_year_offset_invalid_key_content() {
    let app = http::test_app();

    let body = http::fixtures::with_invalid_key_content();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Missing fields returns 400/422.
#[tokio::test]
async fn encrypt_birth_year_offset_missing_fields() {
    let app = http::test_app();

    let body = http::fixtures::empty_object();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response.status() == StatusCode::BAD_REQUEST
            || response.status() == StatusCode::UNPROCESSABLE_ENTITY
    );
}

/// String instead of number for birthYearOffset returns 400/422.
#[tokio::test]
async fn encrypt_birth_year_offset_wrong_type() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = serde_json::json!({
        "birthYearOffset": "not-a-number",
        "publicKey": public_key
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
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
// Verify Age Offset - Happy Path Tests
// ============================================================================

/// Verify age offset returns 200 with valid inputs.
#[tokio::test]
async fn verify_age_offset_success() {
    let app = http::test_app();
    let (_, public_key, key_id) = common::get_test_keys();

    // First encrypt a birth year offset
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(
        100, // Year 2000
        &public_key,
    );

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&encrypt_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(encrypt_response.status(), StatusCode::OK);
    let encrypt_json = http::parse_json_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Now verify age
    let verify_body = http::fixtures::verify_age_offset_request(
        ciphertext, 2025, // Current year
        18,   // Min age
        &key_id,
    );

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);

    let json = http::parse_json_body(verify_response).await;
    assert!(json["resultCiphertext"].is_string());
    assert!(!json["resultCiphertext"].as_str().unwrap().is_empty());
}

/// Verify age with default minAge (18) works.
#[tokio::test]
async fn verify_age_offset_default_min_age() {
    let app = http::test_app();
    let (_, public_key, key_id) = common::get_test_keys();

    // Encrypt birth year offset
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &public_key);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&encrypt_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_json_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Verify without minAge field (should use default 18)
    let verify_body =
        http::fixtures::verify_age_offset_request_default_min_age(ciphertext, 2025, &key_id);

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);
}

/// Verify with custom minAge (21) works.
#[tokio::test]
async fn verify_age_offset_custom_min_age() {
    let app = http::test_app();
    let (_, public_key, key_id) = common::get_test_keys();

    // Encrypt birth year offset
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &public_key);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&encrypt_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_json_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Verify with minAge = 21
    let verify_body = http::fixtures::verify_age_offset_request(
        ciphertext, 2025, 21, // Legal drinking age in US
        &key_id,
    );

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);
}

// ============================================================================
// Verify Age Offset - Error Tests
// ============================================================================

/// Non-existent key ID returns 404.
#[tokio::test]
async fn verify_age_offset_invalid_key_id() {
    let app = http::test_app();
    let (_, public_key, _) = common::get_test_keys();

    // Encrypt first
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &public_key);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&encrypt_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_json_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Try to verify with invalid key ID
    let verify_body = http::fixtures::with_invalid_key_id(ciphertext);

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::NOT_FOUND);
}

/// Corrupted ciphertext returns 400.
#[tokio::test]
async fn verify_age_offset_invalid_ciphertext() {
    let app = http::test_app();
    let (_, _, key_id) = common::get_test_keys();

    let verify_body = http::fixtures::with_corrupted_ciphertext(&key_id);

    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Year before base year (1900) returns 400.
#[tokio::test]
async fn verify_age_offset_year_before_1900() {
    let app = http::test_app();
    let (_, public_key, key_id) = common::get_test_keys();

    // Encrypt first
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &public_key);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&encrypt_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_json_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Try to verify with year before base year
    let verify_body = serde_json::json!({
        "ciphertext": ciphertext,
        "currentYear": 1800,  // Before base year 1900
        "minAge": 18,
        "keyId": key_id
    });

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Min age exceeding current offset returns 400.
#[tokio::test]
async fn verify_age_offset_min_age_exceeds_offset() {
    let app = http::test_app();
    let (_, public_key, key_id) = common::get_test_keys();

    // Encrypt first
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &public_key);

    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-birth-year-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&encrypt_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let encrypt_json = http::parse_json_body(encrypt_response).await;
    let ciphertext = encrypt_json["ciphertext"].as_str().unwrap();

    // Try to verify with min age greater than possible offset
    // currentYear=1920 gives offset=20, but minAge=25 > 20
    let verify_body = serde_json::json!({
        "ciphertext": ciphertext,
        "currentYear": 1920,
        "minAge": 25,  // Greater than current_year - 1900 (1920-1900=20)
        "keyId": key_id
    });

    let app = http::test_app();
    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Missing required fields returns 400/422.
#[tokio::test]
async fn verify_age_offset_missing_fields() {
    let app = http::test_app();

    let verify_body = http::fixtures::empty_object();

    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-offset")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&verify_body).unwrap()))
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
// HTTP Method Tests
// ============================================================================

/// GET on encrypt endpoint returns 405.
#[tokio::test]
async fn encrypt_birth_year_offset_rejects_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/encrypt-birth-year-offset")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

/// GET on verify endpoint returns 405.
#[tokio::test]
async fn verify_age_offset_rejects_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/verify-age-offset")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

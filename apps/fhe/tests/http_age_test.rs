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
use serde::Deserialize;
use tower::ServiceExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptBirthYearOffsetResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyAgeOffsetResponse {
    #[serde(with = "serde_bytes")]
    result_ciphertext: Vec<u8>,
}

// ============================================================================
// Encrypt Birth Year Offset - Happy Path Tests
// ============================================================================

/// Encrypt birth year offset returns 200 with valid inputs.
#[tokio::test]
async fn encrypt_birth_year_offset_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_birth_year_offset_request(TYPICAL_OFFSET, &key_id);

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

    assert_eq!(response.status(), StatusCode::OK);

    let body: EncryptBirthYearOffsetResponse = http::parse_msgpack_body(response).await;
    assert!(!body.ciphertext.is_empty());
}

/// Encrypt with minimum offset (0) succeeds.
#[tokio::test]
async fn encrypt_birth_year_offset_boundary_zero() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_birth_year_offset_request(MIN_OFFSET, &key_id);

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

    assert_eq!(response.status(), StatusCode::OK);
}

/// Encrypt with maximum offset (255) succeeds.
#[tokio::test]
async fn encrypt_birth_year_offset_boundary_max() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_birth_year_offset_request(MAX_OFFSET, &key_id);

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

    assert_eq!(response.status(), StatusCode::OK);
}

// ============================================================================
// Encrypt Birth Year Offset - Validation Error Tests
// ============================================================================

/// Offset over max (256) returns 400.
#[tokio::test]
async fn encrypt_birth_year_offset_over_max() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_birth_year_offset_request(OVER_MAX_OFFSET, &key_id);

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
}

/// Invalid key id returns 404.
#[tokio::test]
async fn encrypt_birth_year_offset_invalid_key_id() {
    let app = http::test_app();

    let body = http::fixtures::with_invalid_key_id_format();

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

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

/// Valid key ID format but unregistered key returns 404.
#[tokio::test]
async fn encrypt_birth_year_offset_invalid_key_content() {
    let app = http::test_app();

    let body = http::fixtures::with_invalid_key_content();

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

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
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

/// String instead of number for birthYearOffset returns 400/422.
#[tokio::test]
async fn encrypt_birth_year_offset_wrong_type() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "birthYearOffset": "not-a-number",
        "keyId": key_id
    });

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
    let key_id = common::get_registered_key_id();

    // First encrypt a birth year offset
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(
        100, // Year 2000
        &key_id,
    );

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

    assert_eq!(encrypt_response.status(), StatusCode::OK);
    let encrypt_body: EncryptBirthYearOffsetResponse =
        http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = encrypt_body.ciphertext;

    // Now verify age
    let verify_body = http::fixtures::verify_age_offset_request(
        &ciphertext,
        2025, // Current year
        18,   // Min age
        &key_id,
    );

    let app = http::test_app();
    let verify_response = app
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

    assert_eq!(verify_response.status(), StatusCode::OK);

    let verify_body: VerifyAgeOffsetResponse = http::parse_msgpack_body(verify_response).await;
    assert!(!verify_body.result_ciphertext.is_empty());
}

/// Verify age with default minAge (18) works.
#[tokio::test]
async fn verify_age_offset_default_min_age() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt birth year offset
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

    // Verify without minAge field (should use default 18)
    let verify_body =
        http::fixtures::verify_age_offset_request_default_min_age(&ciphertext, 2025, &key_id);

    let app = http::test_app();
    let verify_response = app
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

    assert_eq!(verify_response.status(), StatusCode::OK);
}

/// Verify with custom minAge (21) works.
#[tokio::test]
async fn verify_age_offset_custom_min_age() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt birth year offset
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

    // Verify with minAge = 21
    let verify_body = http::fixtures::verify_age_offset_request(
        &ciphertext,
        2025,
        21, // Legal drinking age in US
        &key_id,
    );

    let app = http::test_app();
    let verify_response = app
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

    assert_eq!(verify_response.status(), StatusCode::OK);
}

// ============================================================================
// Verify Age Offset - Error Tests
// ============================================================================

/// Non-existent key ID returns 404.
#[tokio::test]
async fn verify_age_offset_invalid_key_id() {
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

    // Try to verify with invalid key ID
    let verify_body = http::fixtures::with_invalid_key_id(&ciphertext);

    let app = http::test_app();
    let verify_response = app
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

    assert_eq!(verify_response.status(), StatusCode::NOT_FOUND);
}

/// Corrupted ciphertext returns 400.
#[tokio::test]
async fn verify_age_offset_invalid_ciphertext() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let verify_body = http::fixtures::with_corrupted_ciphertext(&key_id);

    let verify_response = app
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

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Year before base year (1900) returns 400.
#[tokio::test]
async fn verify_age_offset_year_before_1900() {
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

    // Try to verify with year before base year
    let verify_body = http::fixtures::VerifyAgeOffsetRequest {
        ciphertext: ciphertext.clone(),
        current_year: 1800,
        min_age: 18,
        key_id: key_id.clone(),
    };

    let app = http::test_app();
    let verify_response = app
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

    assert_eq!(verify_response.status(), StatusCode::BAD_REQUEST);
}

/// Min age exceeding current offset returns 400.
#[tokio::test]
async fn verify_age_offset_min_age_exceeds_offset() {
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

    // Try to verify with min age greater than possible offset
    // currentYear=1920 gives offset=20, but minAge=25 > 20
    let verify_body = http::fixtures::VerifyAgeOffsetRequest {
        ciphertext: ciphertext.clone(),
        current_year: 1920,
        min_age: 25,
        key_id: key_id.clone(),
    };

    let app = http::test_app();
    let verify_response = app
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

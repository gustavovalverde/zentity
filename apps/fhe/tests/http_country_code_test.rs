//! Country code encryption endpoint HTTP tests.
//!
//! Tests the /encrypt-country-code endpoint.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http::fixtures::country_code_boundaries::*;
use serde::Deserialize;
use tower::ServiceExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptCountryCodeResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    country_code: u16,
}

// ============================================================================
// Happy Path Tests
// ============================================================================

/// Encrypt country code returns 200 with valid inputs.
#[tokio::test]
async fn encrypt_country_code_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_country_code_request(USA, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: EncryptCountryCodeResponse = http::parse_msgpack_body(response).await;
    assert!(!body.ciphertext.is_empty());
    // Country code is echoed back for confirmation
    assert_eq!(body.country_code, USA);
}

/// Encrypt with minimum code (0) succeeds.
#[tokio::test]
async fn encrypt_country_code_boundary_zero() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_country_code_request(MIN_CODE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: EncryptCountryCodeResponse = http::parse_msgpack_body(response).await;
    assert_eq!(body.country_code, MIN_CODE);
}

/// Encrypt with maximum code (999) succeeds.
#[tokio::test]
async fn encrypt_country_code_boundary_max() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_country_code_request(MAX_CODE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: EncryptCountryCodeResponse = http::parse_msgpack_body(response).await;
    assert_eq!(body.country_code, MAX_CODE);
}

/// Encrypt with Germany code (276) - another valid ISO code.
#[tokio::test]
async fn encrypt_country_code_germany() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_country_code_request(GERMANY, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: EncryptCountryCodeResponse = http::parse_msgpack_body(response).await;
    assert_eq!(body.country_code, GERMANY);
}

// ============================================================================
// Validation Error Tests
// ============================================================================

/// Code over max (1000) returns 400.
#[tokio::test]
async fn encrypt_country_code_over_max() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_country_code_request(OVER_MAX_CODE, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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
async fn encrypt_country_code_invalid_key_id() {
    let app = http::test_app();

    let body = serde_json::json!({
        "countryCode": 840,
        "keyId": "not-valid-key-id"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

/// Non-existent key id returns 400.
#[tokio::test]
async fn encrypt_country_code_invalid_key_content() {
    let app = http::test_app();

    let body = serde_json::json!({
        "countryCode": 840,
        "keyId": "00000000-0000-0000-0000-000000000001"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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
async fn encrypt_country_code_missing_fields() {
    let app = http::test_app();

    let body = http::fixtures::empty_object();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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

/// String instead of number for countryCode returns 400/422.
#[tokio::test]
async fn encrypt_country_code_wrong_type() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "countryCode": "not-a-number",
        "keyId": key_id
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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

/// Null countryCode returns 400/422.
#[tokio::test]
async fn encrypt_country_code_null_value() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "countryCode": null,
        "keyId": key_id
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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
// HTTP Method Tests
// ============================================================================

/// GET returns 405.
#[tokio::test]
async fn encrypt_country_code_rejects_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/encrypt-country-code")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

/// Invalid msgpack payload returns 400.
#[tokio::test]
async fn encrypt_country_code_invalid_msgpack() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

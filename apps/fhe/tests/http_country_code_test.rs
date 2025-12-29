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
use tower::ServiceExt;

// ============================================================================
// Happy Path Tests
// ============================================================================

/// Encrypt country code returns 200 with valid inputs.
#[tokio::test]
async fn encrypt_country_code_success() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_country_code_request(USA, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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
    // Country code is echoed back for confirmation
    assert_eq!(json["countryCode"], USA);
}

/// Encrypt with minimum code (0) succeeds.
#[tokio::test]
async fn encrypt_country_code_boundary_zero() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_country_code_request(MIN_CODE, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_json_body(response).await;
    assert_eq!(json["countryCode"], MIN_CODE);
}

/// Encrypt with maximum code (999) succeeds.
#[tokio::test]
async fn encrypt_country_code_boundary_max() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_country_code_request(MAX_CODE, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_json_body(response).await;
    assert_eq!(json["countryCode"], MAX_CODE);
}

/// Encrypt with Germany code (276) - another valid ISO code.
#[tokio::test]
async fn encrypt_country_code_germany() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_country_code_request(GERMANY, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_json_body(response).await;
    assert_eq!(json["countryCode"], GERMANY);
}

// ============================================================================
// Validation Error Tests
// ============================================================================

/// Code over max (1000) returns 400.
#[tokio::test]
async fn encrypt_country_code_over_max() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_country_code_request(OVER_MAX_CODE, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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
async fn encrypt_country_code_invalid_public_key() {
    let app = http::test_app();

    let body = serde_json::json!({
        "countryCode": 840,
        "publicKey": "not-valid-base64!!!"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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
async fn encrypt_country_code_invalid_key_content() {
    let app = http::test_app();

    let body = serde_json::json!({
        "countryCode": 840,
        "publicKey": "SGVsbG8gV29ybGQh"  // "Hello World!" in base64
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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
async fn encrypt_country_code_missing_fields() {
    let app = http::test_app();

    let body = http::fixtures::empty_object();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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

/// String instead of number for countryCode returns 400/422.
#[tokio::test]
async fn encrypt_country_code_wrong_type() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = serde_json::json!({
        "countryCode": "not-a-number",
        "publicKey": public_key
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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

/// Null countryCode returns 400/422.
#[tokio::test]
async fn encrypt_country_code_null_value() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = serde_json::json!({
        "countryCode": null,
        "publicKey": public_key
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
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

/// Missing content type returns 415.
#[tokio::test]
async fn encrypt_country_code_missing_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-country-code")
                .body(Body::from(r#"{"countryCode": 840, "publicKey": "test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

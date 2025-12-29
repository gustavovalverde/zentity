//! Compliance level encryption endpoint HTTP tests.
//!
//! Tests the /encrypt-compliance-level endpoint.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http::fixtures::compliance_boundaries::*;
use tower::ServiceExt;

// ============================================================================
// Happy Path Tests
// ============================================================================

/// Encrypt compliance level returns 200 with valid inputs.
#[tokio::test]
async fn encrypt_compliance_level_success() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_compliance_level_request(TYPICAL_LEVEL, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
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
    // Compliance level is echoed back for confirmation
    assert_eq!(json["complianceLevel"], TYPICAL_LEVEL);
}

/// Encrypt with minimum level (0) succeeds.
#[tokio::test]
async fn encrypt_compliance_level_boundary_zero() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_compliance_level_request(MIN_LEVEL, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_json_body(response).await;
    assert_eq!(json["complianceLevel"], MIN_LEVEL);
}

/// Encrypt with maximum level (10) succeeds.
#[tokio::test]
async fn encrypt_compliance_level_boundary_max() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_compliance_level_request(MAX_LEVEL, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let json = http::parse_json_body(response).await;
    assert_eq!(json["complianceLevel"], MAX_LEVEL);
}

/// All valid levels (0-10) succeed.
#[tokio::test]
async fn encrypt_compliance_level_all_valid_levels() {
    let public_key = common::get_public_key();

    for level in 0..=10u8 {
        let app = http::test_app();
        let body = http::fixtures::encrypt_compliance_level_request(level, &public_key);

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/encrypt-compliance-level")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::OK,
            "Level {} should be valid",
            level
        );
    }
}

// ============================================================================
// Validation Error Tests
// ============================================================================

/// Level over max (11) returns 400.
#[tokio::test]
async fn encrypt_compliance_level_over_max() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_compliance_level_request(OVER_MAX_LEVEL, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// High level (99) returns 400.
#[tokio::test]
async fn encrypt_compliance_level_way_over_max() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = http::fixtures::encrypt_compliance_level_request(99, &public_key);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
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
async fn encrypt_compliance_level_invalid_public_key() {
    let app = http::test_app();

    let body = serde_json::json!({
        "complianceLevel": 5,
        "publicKey": "not-valid-base64!!!"
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
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
async fn encrypt_compliance_level_invalid_key_content() {
    let app = http::test_app();

    let body = serde_json::json!({
        "complianceLevel": 5,
        "publicKey": "SGVsbG8gV29ybGQh"  // "Hello World!" in base64
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
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
async fn encrypt_compliance_level_missing_fields() {
    let app = http::test_app();

    let body = http::fixtures::empty_object();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
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

/// String instead of number for complianceLevel returns 400/422.
#[tokio::test]
async fn encrypt_compliance_level_wrong_type() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = serde_json::json!({
        "complianceLevel": "not-a-number",
        "publicKey": public_key
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
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

/// Null complianceLevel returns 400/422.
#[tokio::test]
async fn encrypt_compliance_level_null_value() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = serde_json::json!({
        "complianceLevel": null,
        "publicKey": public_key
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
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

/// Float value for complianceLevel returns 400/422.
#[tokio::test]
async fn encrypt_compliance_level_float_value() {
    let app = http::test_app();
    let public_key = common::get_public_key();

    let body = serde_json::json!({
        "complianceLevel": 5.5,
        "publicKey": public_key
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    // JSON number 5.5 cannot deserialize to u8
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
async fn encrypt_compliance_level_rejects_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/encrypt-compliance-level")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

/// Missing content type returns 415.
#[tokio::test]
async fn encrypt_compliance_level_missing_content_type() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-compliance-level")
                .body(Body::from(r#"{"complianceLevel": 5, "publicKey": "test"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

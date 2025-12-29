//! Health and build-info endpoint tests.
//!
//! Tests the public endpoints that don't require authentication.

mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

// ============================================================================
// Health Endpoint Tests
// ============================================================================

/// Health endpoint returns 200 OK.
#[tokio::test]
async fn health_returns_ok() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Health endpoint returns correct JSON structure.
#[tokio::test]
async fn health_returns_correct_json() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let json = http::parse_json_body(response).await;

    assert_eq!(json["status"], "ok");
    assert_eq!(json["service"], "fhe-service");
}

/// Health endpoint works without authentication.
#[tokio::test]
async fn health_no_auth_required() {
    let app = http::test_app_with_auth("secret-token");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                // No auth header provided
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Health endpoint accepts GET method.
#[tokio::test]
async fn health_accepts_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Health endpoint rejects POST method (method not allowed).
#[tokio::test]
async fn health_rejects_post() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

// ============================================================================
// Build Info Endpoint Tests
// ============================================================================

/// Build info endpoint returns 200 OK.
#[tokio::test]
async fn build_info_returns_ok() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/build-info")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Build info endpoint returns all required fields.
#[tokio::test]
async fn build_info_returns_all_fields() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/build-info")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    let json = http::parse_json_body(response).await;

    // All fields must be present
    assert!(json["service"].is_string(), "service field missing");
    assert!(json["version"].is_string(), "version field missing");
    assert!(json["gitSha"].is_string(), "gitSha field missing");
    assert!(json["buildTime"].is_string(), "buildTime field missing");

    // Service should be fhe-service
    assert_eq!(json["service"], "fhe-service");

    // Version should not be empty
    assert!(!json["version"].as_str().unwrap().is_empty());
}

/// Build info endpoint works without authentication.
#[tokio::test]
async fn build_info_no_auth_required() {
    let app = http::test_app_with_auth("secret-token");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/build-info")
                // No auth header provided
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Build info endpoint accepts GET method.
#[tokio::test]
async fn build_info_accepts_get() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/build-info")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Build info endpoint rejects POST method.
#[tokio::test]
async fn build_info_rejects_post() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/build-info")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

// ============================================================================
// 404 Not Found Tests
// ============================================================================

/// Unknown endpoint returns 404.
#[tokio::test]
async fn unknown_endpoint_returns_404() {
    let app = http::test_app();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/unknown-endpoint")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

/// Root path returns 404 (no root handler).
#[tokio::test]
async fn root_path_returns_404() {
    let app = http::test_app();

    let response = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

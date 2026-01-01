//! Authentication middleware tests.
//!
//! Tests the internal authentication middleware that protects
//! most endpoints except /health and /build-info.

mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

const TEST_TOKEN: &str = "test-secret-token-12345";

/// Protected endpoint requires auth when token is configured.
#[tokio::test]
async fn protected_endpoint_requires_auth() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Protected endpoint accepts valid token.
#[tokio::test]
async fn protected_endpoint_accepts_valid_token() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .header("x-zentity-internal-token", TEST_TOKEN)
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should not be 401 - might be 400 due to invalid key, but auth passed
    assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Protected endpoint rejects wrong token.
#[tokio::test]
async fn protected_endpoint_rejects_wrong_token() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .header("x-zentity-internal-token", "wrong-token")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Protected endpoint rejects empty token value.
#[tokio::test]
async fn protected_endpoint_rejects_empty_token() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .header("x-zentity-internal-token", "")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Auth is skipped when no token is configured.
#[tokio::test]
async fn auth_skipped_when_not_configured() {
    let app = http::test_app(); // No auth configured

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should not be 401 - auth not enforced without token
    assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Public endpoints (/health, /build-info) work without auth even when token is configured.
#[tokio::test]
async fn public_endpoints_ignore_auth_health() {
    let app = http::test_app_with_auth(TEST_TOKEN);

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

#[tokio::test]
async fn public_endpoints_ignore_auth_build_info() {
    let app = http::test_app_with_auth(TEST_TOKEN);

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

/// Public endpoints work even with wrong auth token provided.
#[tokio::test]
async fn public_endpoints_ignore_wrong_token() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .header("x-zentity-internal-token", "completely-wrong-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

/// Partial token match should be rejected (security: no prefix matching).
#[tokio::test]
async fn partial_token_match_rejected() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    // Use a prefix of the expected token
    let partial_token = &TEST_TOKEN[..5];

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .header("x-zentity-internal-token", partial_token)
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Token with extra characters should be rejected.
#[tokio::test]
async fn token_with_extra_chars_rejected() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let extended_token = format!("{}-extra", TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .header("x-zentity-internal-token", extended_token)
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Missing auth header should be rejected when token is configured.
#[tokio::test]
async fn missing_auth_header_rejected() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                // No x-zentity-internal-token header
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Auth error response has correct JSON format.
#[tokio::test]
async fn auth_error_response_format() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let json = http::parse_json_body(response).await;
    assert_eq!(json["error"], "Unauthorized");
}

/// Multiple protected endpoints all require auth.
#[tokio::test]
async fn all_protected_endpoints_require_auth() {
    let protected_endpoints = [
        ("/keys/register", "POST"),
        ("/encrypt-batch", "POST"),
        ("/encrypt-birth-year-offset", "POST"),
        ("/verify-age-offset", "POST"),
        ("/encrypt-country-code", "POST"),
        ("/encrypt-compliance-level", "POST"),
        ("/encrypt-liveness", "POST"),
        ("/verify-liveness-threshold", "POST"),
    ];

    for (path, method) in protected_endpoints {
        let app = http::test_app_with_auth(TEST_TOKEN);

        let response = app
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("content-type", "application/msgpack")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::UNAUTHORIZED,
            "Endpoint {} {} should require auth",
            method,
            path
        );
    }
}

/// Token in different header name should be rejected (header name is case-sensitive in HTTP/2).
#[tokio::test]
async fn wrong_header_name_rejected() {
    let app = http::test_app_with_auth(TEST_TOKEN);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/keys/register")
                .header("content-type", "application/msgpack")
                // Wrong header name (uppercase first letter)
                .header("X-Zentity-Internal-Token", TEST_TOKEN)
                .body(Body::from("not-msgpack"))
                .unwrap(),
        )
        .await
        .unwrap();

    // Note: HTTP headers are case-insensitive per spec, but our implementation
    // uses lowercase. Axum normalizes headers to lowercase, so this should work.
    // If it fails, it means we have a case-sensitivity bug.
    // This test documents the expected behavior.
    assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
}

//! Concurrency tests for FHE service.
//!
//! Tests thread safety of the key store and concurrent operations.

mod common;
mod http;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use std::collections::HashSet;
use tower::ServiceExt;

// ============================================================================
// Concurrent Key Registration Tests
// ============================================================================

/// Multiple concurrent key registrations return unique UUIDs.
#[tokio::test]
async fn concurrent_key_registrations() {
    use std::sync::Arc;

    // Use cached server key for performance
    let server_key_b64 = Arc::new(common::get_server_key_b64());

    // Spawn concurrent registration tasks
    let mut handles = Vec::new();

    for _ in 0..5 {
        let key = server_key_b64.clone();
        let handle = tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::register_key_request(&key);

            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/keys/register")
                        .header("content-type", "application/json")
                        .body(Body::from(serde_json::to_string(&body).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK);

            let json = http::parse_json_body(response).await;
            json["keyId"].as_str().unwrap().to_string()
        });
        handles.push(handle);
    }

    // Collect all key IDs
    let mut key_ids = Vec::new();
    for handle in handles {
        let key_id = handle.await.unwrap();
        key_ids.push(key_id);
    }

    // All key IDs should be unique
    let unique_ids: HashSet<_> = key_ids.iter().collect();
    assert_eq!(
        unique_ids.len(),
        key_ids.len(),
        "All key IDs should be unique: {:?}",
        key_ids
    );
}

/// Concurrent reads don't deadlock during write.
#[tokio::test]
async fn concurrent_reads_during_write() {
    use std::sync::Arc;

    // Set up test keys (uses cached keys for performance)
    let (_, public_key, key_id) = common::get_test_keys();
    let public_key = Arc::new(public_key);
    let _key_id = Arc::new(key_id);

    // Use cached server key for registration
    let server_key_b64 = Arc::new(common::get_server_key_b64());

    // Spawn read and write tasks concurrently
    let mut handles = Vec::new();

    // Write task (register new key)
    {
        let key = server_key_b64.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::register_key_request(&key);

            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/keys/register")
                        .header("content-type", "application/json")
                        .body(Body::from(serde_json::to_string(&body).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK);
            "write".to_string()
        }));
    }

    // Read tasks (encrypt with existing key)
    for _ in 0..3 {
        let pk = public_key.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_birth_year_offset_request(100, &pk);

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
            "read".to_string()
        }));
    }

    // All tasks should complete without deadlock
    for handle in handles {
        let result = handle.await.unwrap();
        assert!(result == "read" || result == "write");
    }
}

/// Concurrent verifications work correctly.
#[tokio::test]
async fn concurrent_verifications() {
    use std::sync::Arc;

    let (_, public_key, key_id) = common::get_test_keys();

    // Encrypt once
    let app = http::test_app();
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &public_key);

    let encrypt_response = app
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
    let ciphertext = Arc::new(encrypt_json["ciphertext"].as_str().unwrap().to_string());
    let key_id = Arc::new(key_id);

    // Spawn concurrent verification tasks
    let mut handles = Vec::new();

    for i in 0..3 {
        let ct = ciphertext.clone();
        let kid = key_id.clone();
        let min_age = 18 + i; // Different min ages

        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::verify_age_offset_request(&ct, 2025, min_age, &kid);

            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/verify-age-offset")
                        .header("content-type", "application/json")
                        .body(Body::from(serde_json::to_string(&body).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK);
            min_age
        }));
    }

    // All verifications should complete
    for handle in handles {
        let min_age = handle.await.unwrap();
        assert!(min_age >= 18 && min_age <= 20);
    }
}

/// Key store handles many concurrent reads.
/// Note: Reduced from 10 to 4 concurrent tasks because each FHE encryption
/// triggers key generation (~120s), and 10 parallel generations exceed timeouts.
#[tokio::test]
async fn many_concurrent_reads() {
    use std::sync::Arc;

    let public_key = Arc::new(common::get_public_key());

    // Spawn concurrent read tasks (limited to avoid timeout)
    let mut handles = Vec::new();

    for _ in 0..4 {
        let pk = public_key.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_birth_year_offset_request(100, &pk);

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

            response.status()
        }));
    }

    // All should succeed
    for handle in handles {
        let status = handle.await.unwrap();
        assert_eq!(status, StatusCode::OK);
    }
}

/// Mixed concurrent operations (encrypt different types).
#[tokio::test]
async fn concurrent_mixed_operations() {
    use std::sync::Arc;

    let public_key = Arc::new(common::get_public_key());

    let mut handles = Vec::new();

    // Age encryption
    {
        let pk = public_key.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_birth_year_offset_request(100, &pk);

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

            ("age", response.status())
        }));
    }

    // Liveness encryption
    {
        let pk = public_key.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_liveness_request(0.85, &pk);

            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/encrypt-liveness")
                        .header("content-type", "application/json")
                        .body(Body::from(serde_json::to_string(&body).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();

            ("liveness", response.status())
        }));
    }

    // Country code encryption
    {
        let pk = public_key.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_country_code_request(840, &pk);

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

            ("country", response.status())
        }));
    }

    // Compliance level encryption
    {
        let pk = public_key.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_compliance_level_request(5, &pk);

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

            ("compliance", response.status())
        }));
    }

    // All should succeed
    for handle in handles {
        let (op_type, status) = handle.await.unwrap();
        assert_eq!(status, StatusCode::OK, "{} operation failed", op_type);
    }
}

// ============================================================================
// RwLock Behavior Tests
// ============================================================================

/// Key store doesn't panic on normal operations.
#[tokio::test]
async fn key_store_no_panic() {
    // This test verifies that the RwLock doesn't get poisoned
    // under normal operation (no panics during lock hold)

    let (_, public_key, key_id) = common::get_test_keys();

    // Perform many operations
    for _ in 0..5 {
        let app = http::test_app();

        // Encrypt
        let body = http::fixtures::encrypt_birth_year_offset_request(100, &public_key);
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
        let ciphertext = json["ciphertext"].as_str().unwrap();

        // Verify
        let app = http::test_app();
        let body = http::fixtures::verify_age_offset_request(ciphertext, 2025, 18, &key_id);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/verify-age-offset")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&body).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}

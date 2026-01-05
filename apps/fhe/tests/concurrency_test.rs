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
    let server_key_bytes = Arc::new(common::get_server_key_bytes());
    let public_key_bytes = Arc::new(common::get_public_key_bytes());

    // Spawn concurrent registration tasks
    let mut handles = Vec::new();

    for _ in 0..5 {
        let key = server_key_bytes.clone();
        let public_key = public_key_bytes.clone();
        let handle = tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::register_key_request(&key, &public_key);

            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/keys/register")
                        .header("content-type", "application/msgpack")
                        .body(Body::from(http::msgpack_body(&body)))
                        .unwrap(),
                )
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK);

            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct RegisterKeyResponse {
                key_id: String,
            }
            let body: RegisterKeyResponse = http::parse_msgpack_body(response).await;
            body.key_id
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
    let key_id = common::get_registered_key_id();
    let key_id = Arc::new(key_id);

    // Use cached server key for registration
    let server_key_bytes = Arc::new(common::get_server_key_bytes());
    let public_key_bytes = Arc::new(common::get_public_key_bytes());

    // Spawn read and write tasks concurrently
    let mut handles = Vec::new();

    // Write task (register new key)
    {
        let key = server_key_bytes.clone();
        let public_key = public_key_bytes.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::register_key_request(&key, &public_key);

            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/keys/register")
                        .header("content-type", "application/msgpack")
                        .body(Body::from(http::msgpack_body(&body)))
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
        let kid = key_id.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_birth_year_offset_request(100, &kid);

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

    let key_id = common::get_registered_key_id();

    // Encrypt once
    let app = http::test_app();
    let encrypt_body = http::fixtures::encrypt_birth_year_offset_request(100, &key_id);

    let encrypt_response = app
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

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EncryptBirthYearOffsetResponse {
        #[serde(with = "serde_bytes")]
        ciphertext: Vec<u8>,
    }
    let encrypt_body: EncryptBirthYearOffsetResponse =
        http::parse_msgpack_body(encrypt_response).await;
    let ciphertext = Arc::new(encrypt_body.ciphertext);
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
                        .header("content-type", "application/msgpack")
                        .body(Body::from(http::msgpack_body(&body)))
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
        assert!((18..=20).contains(&min_age));
    }
}

/// Key store handles many concurrent reads.
/// Note: Reduced from 10 to 4 concurrent tasks because each FHE encryption
/// triggers key generation (~120s), and 10 parallel generations exceed timeouts.
#[tokio::test]
async fn many_concurrent_reads() {
    use std::sync::Arc;

    let key_id = Arc::new(common::get_registered_key_id());

    // Spawn concurrent read tasks (limited to avoid timeout)
    let mut handles = Vec::new();

    for _ in 0..4 {
        let kid = key_id.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_birth_year_offset_request(100, &kid);

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

    let key_id = Arc::new(common::get_registered_key_id());

    let mut handles = Vec::new();

    // Age encryption
    {
        let kid = key_id.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_birth_year_offset_request(100, &kid);

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

            ("age", response.status())
        }));
    }

    // Liveness encryption
    {
        let kid = key_id.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_liveness_request(0.85, &kid);

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

            ("liveness", response.status())
        }));
    }

    // Country code encryption
    {
        let kid = key_id.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_country_code_request(840, &kid);

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

            ("country", response.status())
        }));
    }

    // Compliance level encryption
    {
        let kid = key_id.clone();
        handles.push(tokio::spawn(async move {
            let app = http::test_app();
            let body = http::fixtures::encrypt_compliance_level_request(5, &kid);

            let response = app
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/encrypt-compliance-level")
                        .header("content-type", "application/msgpack")
                        .body(Body::from(http::msgpack_body(&body)))
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

    let key_id = common::get_registered_key_id();

    // Perform many operations
    for _ in 0..5 {
        let app = http::test_app();

        // Encrypt
        let body = http::fixtures::encrypt_birth_year_offset_request(100, &key_id);
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

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct EncryptBirthYearOffsetResponse {
            #[serde(with = "serde_bytes")]
            ciphertext: Vec<u8>,
        }
        let body: EncryptBirthYearOffsetResponse = http::parse_msgpack_body(response).await;
        let ciphertext = body.ciphertext;

        // Verify
        let app = http::test_app();
        let body = http::fixtures::verify_age_offset_request(&ciphertext, 2025, 18, &key_id);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/verify-age-offset")
                    .header("content-type", "application/msgpack")
                    .body(Body::from(http::msgpack_body(&body)))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}

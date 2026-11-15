//! Batch encryption endpoint HTTP tests.
//!
//! Tests the /encrypt-batch endpoint.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde::Deserialize;
use serde_bytes::ByteBuf;
use tower::ServiceExt;

use crate::{common, http};
use http::fixtures::{
    compliance_boundaries, country_code_boundaries, dob_days_boundaries, liveness_boundaries,
};

async fn post_batch(body: serde_json::Value) -> axum::response::Response {
    http::test_app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-batch")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptBatchResponse {
    dob_days_ciphertext: Option<ByteBuf>,
    country_code_ciphertext: Option<ByteBuf>,
    compliance_level_ciphertext: Option<ByteBuf>,
    liveness_score_ciphertext: Option<ByteBuf>,
}

/// Batch encryption returns ciphertexts for provided fields.
#[tokio::test]
async fn encrypt_batch_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "keyId": key_id,
        "dobDays": 40_000,
        "countryCode": 840,
        "complianceLevel": 3,
        "livenessScore": 0.85
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-batch")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: EncryptBatchResponse = http::parse_msgpack_body(response).await;
    assert!(body.dob_days_ciphertext.is_some());
    assert!(body.country_code_ciphertext.is_some());
    assert!(body.compliance_level_ciphertext.is_some());
    assert!(body.liveness_score_ciphertext.is_some());
}

/// Empty batch payload returns 400.
#[tokio::test]
async fn encrypt_batch_requires_payload() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = serde_json::json!({
        "keyId": key_id
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-batch")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// Non-existent key id returns 404.
#[tokio::test]
async fn encrypt_batch_invalid_key() {
    let app = http::test_app();

    let body = serde_json::json!({
        "keyId": "00000000-0000-0000-0000-000000000000",
        "dobDays": 40_000
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-batch")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

/// Each attribute can be encrypted on its own, and only that ciphertext is returned.
#[tokio::test]
async fn encrypt_batch_single_attribute() {
    let key_id = common::get_registered_key_id();
    let cases = [
        (
            "dobDays",
            serde_json::json!(dob_days_boundaries::TYPICAL_DAYS),
        ),
        (
            "countryCode",
            serde_json::json!(country_code_boundaries::USA),
        ),
        (
            "complianceLevel",
            serde_json::json!(compliance_boundaries::TYPICAL_LEVEL),
        ),
        (
            "livenessScore",
            serde_json::json!(liveness_boundaries::TYPICAL_SCORE),
        ),
    ];

    for (field, value) in cases {
        let response = post_batch(serde_json::json!({ "keyId": key_id, field: value })).await;
        assert_eq!(response.status(), StatusCode::OK, "{field}");

        let body: EncryptBatchResponse = http::parse_msgpack_body(response).await;
        let present = [
            ("dobDays", body.dob_days_ciphertext.is_some()),
            ("countryCode", body.country_code_ciphertext.is_some()),
            (
                "complianceLevel",
                body.compliance_level_ciphertext.is_some(),
            ),
            ("livenessScore", body.liveness_score_ciphertext.is_some()),
        ];
        for (name, is_present) in present {
            assert_eq!(is_present, name == field, "{field} request, {name} result");
        }
    }
}

/// Values at the edges of each attribute's range are accepted.
#[tokio::test]
async fn encrypt_batch_accepts_boundary_values() {
    let key_id = common::get_registered_key_id();
    let cases = [
        ("dobDays", serde_json::json!(dob_days_boundaries::MIN_DAYS)),
        ("dobDays", serde_json::json!(dob_days_boundaries::MAX_DAYS)),
        (
            "countryCode",
            serde_json::json!(country_code_boundaries::MIN_CODE),
        ),
        (
            "countryCode",
            serde_json::json!(country_code_boundaries::MAX_CODE),
        ),
        (
            "complianceLevel",
            serde_json::json!(compliance_boundaries::MIN_LEVEL),
        ),
        (
            "complianceLevel",
            serde_json::json!(compliance_boundaries::MAX_LEVEL),
        ),
        (
            "livenessScore",
            serde_json::json!(liveness_boundaries::MIN_SCORE),
        ),
        (
            "livenessScore",
            serde_json::json!(liveness_boundaries::MAX_SCORE),
        ),
    ];

    for (field, value) in cases {
        let response =
            post_batch(serde_json::json!({ "keyId": key_id, field: value.clone() })).await;
        assert_eq!(response.status(), StatusCode::OK, "{field}={value}");
    }
}

/// Values outside an attribute's range, or of the wrong type, return 400.
#[tokio::test]
async fn encrypt_batch_rejects_invalid_values() {
    let key_id = common::get_registered_key_id();
    let cases = [
        (
            "dobDays",
            serde_json::json!(dob_days_boundaries::MAX_DAYS + 1),
        ),
        (
            "countryCode",
            serde_json::json!(country_code_boundaries::OVER_MAX_CODE),
        ),
        (
            "complianceLevel",
            serde_json::json!(compliance_boundaries::OVER_MAX_LEVEL),
        ),
        ("complianceLevel", serde_json::json!(99)),
        (
            "livenessScore",
            serde_json::json!(liveness_boundaries::OVER_MAX_SCORE),
        ),
        (
            "livenessScore",
            serde_json::json!(liveness_boundaries::NEGATIVE_SCORE),
        ),
        ("countryCode", serde_json::json!("840")),
        ("complianceLevel", serde_json::json!(3.5)),
        ("livenessScore", serde_json::json!("0.85")),
    ];

    for (field, value) in cases {
        let response =
            post_batch(serde_json::json!({ "keyId": key_id, field: value.clone() })).await;
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "{field}={value}"
        );
    }
}

/// A request without a key id returns 400.
#[tokio::test]
async fn encrypt_batch_requires_key_id() {
    let response = post_batch(serde_json::json!({ "dobDays": 40_000 })).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

/// GET on the batch endpoint returns 405.
#[tokio::test]
async fn encrypt_batch_rejects_get() {
    let response = http::test_app()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/encrypt-batch")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
}

//! DOB (days) verification endpoint HTTP tests.
//!
//! Tests the /encrypt-dob-days and /verify-age-from-dob endpoints.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde::Deserialize;
use tower::ServiceExt;

use crate::{common, http};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptDobDaysResponse {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyAgeFromDobResponse {
    #[serde(with = "serde_bytes")]
    result_ciphertext: Vec<u8>,
}

#[tokio::test]
async fn encrypt_dob_days_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_dob_days_request(40_000, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-dob-days")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body: EncryptDobDaysResponse = http::parse_msgpack_body(response).await;
    assert!(!body.ciphertext.is_empty());
}

#[tokio::test]
async fn verify_age_from_dob_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt a DOB value first.
    let encrypt_body = http::fixtures::encrypt_dob_days_request(20_000, &key_id);
    let encrypt_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-dob-days")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&encrypt_body)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(encrypt_response.status(), StatusCode::OK);
    let encrypt_body: EncryptDobDaysResponse = http::parse_msgpack_body(encrypt_response).await;

    // Verify age using the encrypted DOB.
    let verify_body =
        http::fixtures::verify_age_from_dob_request(&encrypt_body.ciphertext, 50_000, 18, &key_id);

    let verify_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/verify-age-from-dob")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&verify_body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::OK);

    let body: VerifyAgeFromDobResponse = http::parse_msgpack_body(verify_response).await;
    assert!(!body.result_ciphertext.is_empty());
}

#[tokio::test]
async fn encrypt_dob_days_over_max_returns_400() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    let body = http::fixtures::encrypt_dob_days_request(150_001, &key_id);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/encrypt-dob-days")
                .header("content-type", "application/msgpack")
                .body(Body::from(http::msgpack_body(&body)))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

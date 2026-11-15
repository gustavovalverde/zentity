//! DOB (days) verification endpoint HTTP tests.
//!
//! Tests the /verify-age-from-dob endpoint. Ciphertexts under test come from /encrypt-batch.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde::Deserialize;
use tower::ServiceExt;

use crate::{common, http};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyAgeFromDobResponse {
    #[serde(with = "serde_bytes")]
    result_ciphertext: Vec<u8>,
}

#[tokio::test]
async fn verify_age_from_dob_success() {
    let app = http::test_app();
    let key_id = common::get_registered_key_id();

    // Encrypt a DOB value first.
    let ciphertext = http::encrypt_attribute("dobDays", 20_000, &key_id).await;

    // Verify age using the encrypted DOB.
    let verify_body = http::fixtures::verify_age_from_dob_request(&ciphertext, 50_000, 18, &key_id);

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

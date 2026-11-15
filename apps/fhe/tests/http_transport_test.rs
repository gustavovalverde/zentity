//! Transport tests: gzip request and response bodies, body limit, and timeout.

mod http;

use std::convert::Infallible;
use std::io::{Read, Write};
use std::time::Duration;

use axum::{
    body::{Body, Bytes},
    http::{header, Request, StatusCode},
    response::Response,
};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use http_body_util::channel::Channel;
use tower::ServiceExt;

use http::TestAppBuilder;

const UNREGISTERED_KEY_ID: &str = "00000000-0000-0000-0000-000000000000";

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

/// A batch request without attributes, which the handler rejects with 400 after decoding it.
fn empty_batch_body() -> Vec<u8> {
    http::msgpack_body(&serde_json::json!({ "keyId": UNREGISTERED_KEY_ID }))
}

fn batch_request() -> axum::http::request::Builder {
    Request::builder()
        .method("POST")
        .uri("/encrypt-batch")
        .header(header::CONTENT_TYPE, "application/msgpack")
}

async fn error_message(response: Response) -> String {
    http::parse_json_body(response).await["error"]
        .as_str()
        .expect("error string")
        .to_string()
}

/// A gzip request body is decompressed before it is decoded.
#[tokio::test]
async fn gzip_request_body_is_decoded() {
    let response = TestAppBuilder::new()
        .build()
        .oneshot(
            batch_request()
                .header(header::CONTENT_ENCODING, "gzip")
                .body(Body::from(gzip(&empty_batch_body())))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(error_message(response)
        .await
        .contains("At least one attribute"));
}

/// The body limit applies to the decompressed size, so a small gzip bomb is refused.
#[tokio::test]
async fn gzip_request_body_is_bounded_after_decompression() {
    let bomb = gzip(&vec![0u8; 1024 * 1024]);
    assert!(
        bomb.len() < 64 * 1024,
        "bomb must fit under the limit compressed"
    );

    let response = TestAppBuilder::new()
        .with_body_limit_bytes(64 * 1024)
        .build()
        .oneshot(
            batch_request()
                .header(header::CONTENT_ENCODING, "gzip")
                .body(Body::from(bomb))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

/// A gzip stream of empty stored blocks: large on the wire, empty once decompressed.
fn padded_empty_gzip(blocks: usize) -> Vec<u8> {
    let mut stream = vec![0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff];
    for _ in 0..blocks {
        stream.extend_from_slice(&[0x00, 0x00, 0x00, 0xff, 0xff]);
    }
    stream.extend_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
    stream.extend_from_slice(&[0; 8]); // CRC-32 and size of the empty payload
    stream
}

/// The body limit also applies to the compressed bytes on the wire, so a body that
/// decompresses to almost nothing cannot be streamed without bound.
#[tokio::test]
async fn gzip_request_body_is_bounded_on_the_wire() {
    let padded = padded_empty_gzip(100_000);
    assert!(padded.len() > 64 * 1024);
    let mut decoded = Vec::new();
    GzDecoder::new(padded.as_slice())
        .read_to_end(&mut decoded)
        .unwrap();
    assert!(
        decoded.is_empty(),
        "the padded stream must decode to nothing"
    );

    let announced = TestAppBuilder::new()
        .with_body_limit_bytes(64 * 1024)
        .build()
        .oneshot(
            batch_request()
                .header(header::CONTENT_ENCODING, "gzip")
                .header(header::CONTENT_LENGTH, padded.len())
                .body(Body::from(padded.clone()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(announced.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // Without a Content-Length header the limit is enforced while the body is read.
    let streamed = TestAppBuilder::new()
        .with_body_limit_bytes(64 * 1024)
        .build()
        .oneshot(
            batch_request()
                .header(header::CONTENT_ENCODING, "gzip")
                .body(Body::from(padded))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(streamed.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

/// A corrupt gzip stream is a 400 in the service's JSON error format.
#[tokio::test]
async fn corrupt_gzip_request_body_returns_json_400() {
    let response = TestAppBuilder::new()
        .build()
        .oneshot(
            batch_request()
                .header(header::CONTENT_ENCODING, "gzip")
                .body(Body::from("this is not gzip"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(!error_message(response).await.is_empty());
}

/// Content encodings other than gzip and identity are refused.
#[tokio::test]
async fn unsupported_content_encoding_returns_415() {
    let response = TestAppBuilder::new()
        .build()
        .oneshot(
            batch_request()
                .header(header::CONTENT_ENCODING, "br")
                .body(Body::from(empty_batch_body()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

/// Responses are gzipped when the client accepts gzip.
#[tokio::test]
async fn response_is_gzipped_when_accepted() {
    let response = TestAppBuilder::new()
        .build()
        .oneshot(
            batch_request()
                .header(header::ACCEPT_ENCODING, "gzip")
                .body(Body::from(empty_batch_body()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
    assert!(response.headers()[header::VARY]
        .to_str()
        .unwrap()
        .to_ascii_lowercase()
        .contains("accept-encoding"));

    use http_body_util::BodyExt;
    let compressed = response.into_body().collect().await.unwrap().to_bytes();
    let mut decoded = String::new();
    GzDecoder::new(compressed.as_ref())
        .read_to_string(&mut decoded)
        .unwrap();
    let json: serde_json::Value = serde_json::from_str(&decoded).unwrap();
    assert!(json["error"].is_string());
}

/// `gzip;q=0` means the client refuses gzip.
#[tokio::test]
async fn response_is_not_gzipped_when_refused() {
    let response = TestAppBuilder::new()
        .build()
        .oneshot(
            batch_request()
                .header(header::ACCEPT_ENCODING, "gzip;q=0")
                .body(Body::from(empty_batch_body()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(response.headers().get(header::CONTENT_ENCODING).is_none());
    assert!(error_message(response)
        .await
        .contains("At least one attribute"));
}

/// A request that outlives the timeout returns 408.
#[tokio::test]
async fn stalled_request_returns_408() {
    // The sender stays alive and silent, so the handler waits for the body.
    let (_sender, stalled_body) = Channel::<Bytes, Infallible>::new(1);

    let response = TestAppBuilder::new()
        .with_request_timeout(Duration::from_millis(50))
        .build()
        .oneshot(batch_request().body(Body::new(stalled_body)).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::REQUEST_TIMEOUT);
}

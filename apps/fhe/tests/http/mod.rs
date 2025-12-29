//! HTTP test utilities for FHE service integration tests.
//!
//! Provides a test app builder that mirrors the production router setup
//! while allowing configurable auth.
#![allow(dead_code)]

use axum::{http::StatusCode, response::Response, Router};

use fhe_service::{app::build_router, crypto, settings::Settings};

pub mod fixtures;

/// Builder for creating test routers with configurable auth and limits.
pub struct TestAppBuilder {
    settings: Settings,
}

impl Default for TestAppBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl TestAppBuilder {
    /// Create a new test app builder with default settings.
    pub fn new() -> Self {
        // Initialize crypto keys once for all tests
        crypto::init_keys();

        Self {
            settings: Settings::for_tests(),
        }
    }

    /// Configure authentication token requirement.
    pub fn with_auth(mut self, token: &str) -> Self {
        self.settings = self.settings.with_internal_token(Some(token.to_string()));
        self
    }

    /// Build the test router.
    pub fn build(self) -> Router {
        build_router(&self.settings)
    }
}

/// Create a test router without authentication.
pub fn test_app() -> Router {
    TestAppBuilder::new().build()
}

/// Create a test router with authentication required.
pub fn test_app_with_auth(token: &str) -> Router {
    TestAppBuilder::new().with_auth(token).build()
}

/// Helper to parse JSON response body.
pub async fn parse_json_body(response: Response) -> serde_json::Value {
    use http_body_util::BodyExt;

    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

/// Helper to get response status and body as string (for debugging).
pub async fn response_debug(response: Response) -> (StatusCode, String) {
    use http_body_util::BodyExt;

    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&body).to_string();
    (status, text)
}

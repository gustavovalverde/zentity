//! Health check and build info endpoints.
//!
//! These endpoints are public (no authentication required) and available
//! on both coordinator and signer roles.

use actix_web::{HttpResponse, web};
use serde::{Deserialize, Serialize};

use crate::config::Settings;

/// Health check response.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct HealthResponse {
    pub status: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer_id: Option<String>,
}

/// Build information response.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfoResponse {
    pub service: String,
    pub version: String,
    pub role: String,
    pub git_sha: String,
    pub build_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer_id: Option<String>,
    pub ciphersuite: String,
}

/// GET /health
///
/// Returns service health status. Used by load balancers and monitoring.
#[tracing::instrument(skip(settings))]
pub async fn health(settings: web::Data<Settings>) -> HttpResponse {
    let response = HealthResponse {
        status: "ok".to_string(),
        role: settings.role().to_string(),
        signer_id: settings.signer_id().map(String::from),
    };

    HttpResponse::Ok().json(response)
}

/// GET /build-info
///
/// Returns build metadata for deployment verification.
#[tracing::instrument(skip(settings))]
pub async fn build_info(settings: web::Data<Settings>) -> HttpResponse {
    let response = BuildInfoResponse {
        service: "signer-service".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        role: settings.role().to_string(),
        git_sha: env!("GIT_SHA").to_string(),
        build_time: env!("BUILD_TIME").to_string(),
        signer_id: settings.signer_id().map(String::from),
        ciphersuite: settings.ciphersuite().to_string(),
    };

    HttpResponse::Ok().json(response)
}

/// Configure health routes on the given scope.
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.route("/health", web::get().to(health))
        .route("/build-info", web::get().to(build_info));
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{App, test};

    #[actix_rt::test]
    async fn test_health_coordinator() {
        let settings = Settings::for_coordinator_tests();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(settings))
                .configure(configure),
        )
        .await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());

        let body: HealthResponse = test::read_body_json(resp).await;
        assert_eq!(body.status, "ok");
        assert_eq!(body.role, "coordinator");
        assert!(body.signer_id.is_none());
    }

    #[actix_rt::test]
    async fn test_health_signer() {
        let settings = Settings::for_signer_tests("signer-1", 5101);
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(settings))
                .configure(configure),
        )
        .await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());

        let body: HealthResponse = test::read_body_json(resp).await;
        assert_eq!(body.status, "ok");
        assert_eq!(body.role, "signer");
        assert_eq!(body.signer_id, Some("signer-1".to_string()));
    }

    #[actix_rt::test]
    async fn test_build_info() {
        let settings = Settings::for_coordinator_tests();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(settings))
                .configure(configure),
        )
        .await;

        let req = test::TestRequest::get().uri("/build-info").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.status().is_success());

        let body: BuildInfoResponse = test::read_body_json(resp).await;
        assert_eq!(body.service, "signer-service");
        assert_eq!(body.role, "coordinator");
    }
}

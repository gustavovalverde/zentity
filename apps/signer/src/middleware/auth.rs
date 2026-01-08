//! Internal authentication middleware for coordinator endpoints.
//!
//! Enforces INTERNAL_SERVICE_TOKEN when required (production) and allows
//! health/build-info endpoints to remain public.

use actix_web::body::{EitherBody, MessageBody};
use actix_web::dev::{Service, ServiceRequest, ServiceResponse, Transform, forward_ready};
use actix_web::{Error, HttpResponse};
use futures_util::future::{LocalBoxFuture, Ready, ready};

use crate::config::Settings;

/// Middleware enforcing internal service token authentication.
#[derive(Clone)]
pub struct InternalAuth {
    required: bool,
    token: Option<String>,
}

impl InternalAuth {
    /// Build from service settings.
    pub fn new(settings: &Settings) -> Self {
        Self {
            required: settings.internal_token_required(),
            token: settings.internal_token().map(ToString::to_string),
        }
    }

    /// Build directly from config (used for tests).
    pub fn from_config(required: bool, token: Option<String>) -> Self {
        Self { required, token }
    }

    fn is_public_path(path: &str) -> bool {
        matches!(path, "/health" | "/build-info")
    }

    fn extract_token(req: &ServiceRequest) -> Option<String> {
        let headers = req.headers();

        // Prefer Authorization: Bearer <token>
        if let Some(value) = headers.get("authorization")
            && let Ok(value) = value.to_str()
            && let Some(token) = value.strip_prefix("Bearer ")
        {
            return Some(token.trim().to_string());
        }

        // Fallback: X-Internal-Token header
        if let Some(value) = headers.get("x-internal-token")
            && let Ok(value) = value.to_str()
        {
            return Some(value.trim().to_string());
        }

        None
    }
}

impl<S, B> Transform<S, ServiceRequest> for InternalAuth
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type InitError = ();
    type Transform = InternalAuthMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(InternalAuthMiddleware {
            service,
            required: self.required,
            token: self.token.clone(),
        }))
    }
}

pub struct InternalAuthMiddleware<S> {
    service: S,
    required: bool,
    token: Option<String>,
}

impl<S, B> Service<ServiceRequest> for InternalAuthMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<EitherBody<B>>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let required = self.required;
        let expected = self.token.clone();
        let path = req.path().to_string();

        if !InternalAuth::is_public_path(&path) {
            let provided = InternalAuth::extract_token(&req);

            let authorized = if required {
                expected
                    .as_deref()
                    .is_some_and(|expected| provided.as_deref() == Some(expected))
            } else if let (Some(expected), Some(provided)) =
                (expected.as_deref(), provided.as_deref())
            {
                provided == expected
            } else {
                true
            };

            if !authorized {
                let (req, _pl) = req.into_parts();
                let response = HttpResponse::Unauthorized().json(serde_json::json!({
                    "error": "Unauthorized",
                }));
                return Box::pin(async move {
                    Ok(ServiceResponse::new(req, response.map_into_right_body()))
                });
            }
        }

        let fut = self.service.call(req);
        Box::pin(async move { fut.await.map(ServiceResponse::map_into_left_body) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{App, HttpResponse, test, web};

    #[actix_rt::test]
    async fn allows_public_routes_without_token() {
        let auth = InternalAuth::from_config(true, Some("secret".to_string()));

        let app = test::init_service(App::new().wrap(auth).route(
            "/health",
            web::get().to(|| async { HttpResponse::Ok().finish() }),
        ))
        .await;

        let req = test::TestRequest::get().uri("/health").to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[actix_rt::test]
    async fn rejects_missing_token_when_required() {
        let auth = InternalAuth::from_config(true, Some("secret".to_string()));

        let app = test::init_service(App::new().wrap(auth).route(
            "/protected",
            web::get().to(|| async { HttpResponse::Ok().finish() }),
        ))
        .await;

        let req = test::TestRequest::get().uri("/protected").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_rt::test]
    async fn accepts_valid_token_when_required() {
        let auth = InternalAuth::from_config(true, Some("secret".to_string()));

        let app = test::init_service(App::new().wrap(auth).route(
            "/protected",
            web::get().to(|| async { HttpResponse::Ok().finish() }),
        ))
        .await;

        let req = test::TestRequest::get()
            .uri("/protected")
            .insert_header(("authorization", "Bearer secret"))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }
}

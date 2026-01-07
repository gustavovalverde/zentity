//! Signing HTTP endpoints.
//!
//! These endpoints are exposed by the coordinator to orchestrate signing sessions.

use actix_web::{HttpResponse, ResponseError, web};

use crate::frost::{
    Coordinator, SigningAggregateRequest, SigningCommitRequest, SigningInitRequest,
    SigningSubmitPartialRequest,
};

/// POST /signing/init
///
/// Initialize a new signing session.
#[tracing::instrument(skip(coordinator, request), fields(group_pubkey_prefix = &request.group_pubkey[..16.min(request.group_pubkey.len())]))]
pub async fn init_signing(
    coordinator: web::Data<Coordinator>,
    request: web::Json<SigningInitRequest>,
) -> HttpResponse {
    match coordinator.init_signing(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signing init failed");
            e.error_response()
        }
    }
}

/// POST /signing/commit
///
/// Submit a signing commitment from a participant.
#[tracing::instrument(skip(coordinator, request), fields(session_id = %request.session_id, participant = request.participant_id))]
pub async fn submit_commitment(
    coordinator: web::Data<Coordinator>,
    request: web::Json<SigningCommitRequest>,
) -> HttpResponse {
    match coordinator.submit_commitment(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signing commitment submission failed");
            e.error_response()
        }
    }
}

/// POST /signing/partial
///
/// Submit a partial signature from a signer.
#[tracing::instrument(skip(coordinator, request), fields(session_id = %request.session_id, participant = request.participant_id))]
pub async fn submit_partial(
    coordinator: web::Data<Coordinator>,
    request: web::Json<SigningSubmitPartialRequest>,
) -> HttpResponse {
    match coordinator.submit_partial(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Partial signature submission failed");
            e.error_response()
        }
    }
}

/// POST /signing/aggregate
///
/// Aggregate partial signatures into final signature.
#[tracing::instrument(skip(coordinator, request), fields(session_id = %request.session_id))]
pub async fn aggregate_signatures(
    coordinator: web::Data<Coordinator>,
    request: web::Json<SigningAggregateRequest>,
) -> HttpResponse {
    match coordinator.aggregate_signatures(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signing aggregation failed");
            e.error_response()
        }
    }
}

/// GET /signing/{session_id}
///
/// Get signing session status.
#[tracing::instrument(skip(coordinator))]
pub async fn get_session(
    coordinator: web::Data<Coordinator>,
    session_id: web::Path<uuid::Uuid>,
) -> HttpResponse {
    match coordinator.get_signing_session(&session_id) {
        Ok(Some(session)) => HttpResponse::Ok().json(session),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Session not found"
        })),
        Err(e) => {
            tracing::error!(error = %e, "Failed to get signing session");
            e.error_response()
        }
    }
}

/// Configure signing routes on the given scope.
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/signing")
            .route("/init", web::post().to(init_signing))
            .route("/commit", web::post().to(submit_commitment))
            .route("/partial", web::post().to(submit_partial))
            .route("/aggregate", web::post().to(aggregate_signatures))
            .route("/{session_id}", web::get().to(get_session)),
    );
}

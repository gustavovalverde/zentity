//! DKG (Distributed Key Generation) HTTP endpoints.
//!
//! These endpoints are exposed by the coordinator to orchestrate DKG sessions.

use actix_web::{HttpResponse, ResponseError, web};

use crate::frost::{
    Coordinator, DkgFinalizeRequest, DkgInitRequest, DkgRound1Request, DkgRound2Request,
};

/// POST /dkg/init
///
/// Initialize a new DKG session.
#[tracing::instrument(skip(coordinator, request), fields(threshold = request.threshold, total = request.total_participants))]
pub async fn init_dkg(
    coordinator: web::Data<Coordinator>,
    request: web::Json<DkgInitRequest>,
) -> HttpResponse {
    match coordinator.init_dkg(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "DKG init failed");
            e.error_response()
        }
    }
}

/// POST /dkg/round1
///
/// Submit a round 1 package from a participant.
#[tracing::instrument(skip(coordinator, request), fields(session_id = %request.session_id, participant = %request.participant_id))]
pub async fn submit_round1(
    coordinator: web::Data<Coordinator>,
    request: web::Json<DkgRound1Request>,
) -> HttpResponse {
    match coordinator.submit_round1(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "DKG round1 submission failed");
            e.error_response()
        }
    }
}

/// POST /dkg/round2
///
/// Submit an encrypted round 2 package from a participant.
#[tracing::instrument(skip(coordinator, request), fields(session_id = %request.session_id, from = %request.from_participant_id, to = %request.to_participant_id))]
pub async fn submit_round2(
    coordinator: web::Data<Coordinator>,
    request: web::Json<DkgRound2Request>,
) -> HttpResponse {
    match coordinator.submit_round2(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "DKG round2 submission failed");
            e.error_response()
        }
    }
}

/// POST /dkg/finalize
///
/// Finalize a DKG session after all round 2 packages are received.
#[tracing::instrument(skip(coordinator, request), fields(session_id = %request.session_id))]
pub async fn finalize_dkg(
    coordinator: web::Data<Coordinator>,
    request: web::Json<DkgFinalizeRequest>,
) -> HttpResponse {
    match coordinator.finalize_dkg(request.into_inner()).await {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "DKG finalize failed");
            e.error_response()
        }
    }
}

/// GET /dkg/{session_id}
///
/// Get DKG session status.
#[tracing::instrument(skip(coordinator))]
pub async fn get_session(
    coordinator: web::Data<Coordinator>,
    session_id: web::Path<uuid::Uuid>,
) -> HttpResponse {
    match coordinator.get_dkg_session(&session_id) {
        Ok(Some(session)) => HttpResponse::Ok().json(session),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "Session not found"
        })),
        Err(e) => {
            tracing::error!(error = %e, "Failed to get DKG session");
            e.error_response()
        }
    }
}

/// Configure DKG routes on the given scope.
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/dkg")
            .route("/init", web::post().to(init_dkg))
            .route("/round1", web::post().to(submit_round1))
            .route("/round2", web::post().to(submit_round2))
            .route("/finalize", web::post().to(finalize_dkg))
            .route("/{session_id}", web::get().to(get_session)),
    );
}

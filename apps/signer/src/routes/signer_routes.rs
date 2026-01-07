//! Signer-specific HTTP endpoints.
//!
//! These endpoints are exposed by signer instances and called by the coordinator.
//! They handle DKG participation and partial signature generation.

use actix_web::{HttpResponse, ResponseError, web};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

use crate::frost::{
    SignerCommitRequest, SignerDkgFinalizeRequest, SignerDkgRound1Request, SignerDkgRound2Request,
    SignerPartialSignRequest, SignerService,
};

/// POST /signer/dkg/round1
///
/// Generate DKG round 1 package.
#[tracing::instrument(skip(signer, request), fields(session_id = %request.session_id, participant = request.participant_id))]
pub async fn dkg_round1(
    signer: web::Data<SignerService>,
    request: web::Json<SignerDkgRound1Request>,
) -> HttpResponse {
    // Verify this is the correct signer
    if request.participant_id != signer.participant_id() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": format!(
                "Participant ID mismatch: expected {}, got {}",
                signer.participant_id(),
                request.participant_id
            )
        }));
    }

    match signer.dkg_round1(
        &request.session_id,
        request.threshold,
        request.total_participants,
    ) {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signer DKG round1 failed");
            e.error_response()
        }
    }
}

/// POST /signer/dkg/round2
///
/// Generate DKG round 2 packages.
#[tracing::instrument(skip(signer, request), fields(session_id = %request.session_id, participant = request.participant_id))]
pub async fn dkg_round2(
    signer: web::Data<SignerService>,
    request: web::Json<SignerDkgRound2Request>,
) -> HttpResponse {
    // Verify this is the correct signer
    if request.participant_id != signer.participant_id() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": format!(
                "Participant ID mismatch: expected {}, got {}",
                signer.participant_id(),
                request.participant_id
            )
        }));
    }

    match signer.dkg_round2(
        &request.session_id,
        &request.round1_packages,
        &request.participant_hpke_pubkeys,
    ) {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signer DKG round2 failed");
            e.error_response()
        }
    }
}

/// POST /signer/dkg/finalize
///
/// Finalize DKG and store key share.
#[tracing::instrument(skip(signer, request), fields(session_id = %request.session_id, participant = request.participant_id))]
pub async fn dkg_finalize(
    signer: web::Data<SignerService>,
    request: web::Json<SignerDkgFinalizeRequest>,
) -> HttpResponse {
    // Verify this is the correct signer
    if request.participant_id != signer.participant_id() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": format!(
                "Participant ID mismatch: expected {}, got {}",
                signer.participant_id(),
                request.participant_id
            )
        }));
    }

    match signer.dkg_finalize(
        &request.session_id,
        &request.round1_packages,
        &request.round2_packages,
    ) {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signer DKG finalize failed");
            e.error_response()
        }
    }
}

/// POST /signer/sign/commit
///
/// Generate signing commitment.
#[tracing::instrument(skip(signer, request), fields(session_id = %request.session_id))]
pub async fn sign_commit(
    signer: web::Data<SignerService>,
    request: web::Json<SignerCommitRequest>,
) -> HttpResponse {
    match signer
        .sign_commit(
            &request.session_id,
            &request.group_pubkey,
            request.guardian_assertion.as_deref(),
        )
        .await
    {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signer commitment generation failed");
            e.error_response()
        }
    }
}

/// POST /signer/sign/partial
///
/// Generate partial signature.
#[tracing::instrument(skip(signer, request), fields(session_id = %request.session_id))]
pub async fn sign_partial(
    signer: web::Data<SignerService>,
    request: web::Json<SignerPartialSignRequest>,
) -> HttpResponse {
    // Decode message
    let message = match BASE64.decode(&request.message) {
        Ok(m) => m,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("Invalid message base64: {}", e)
            }));
        }
    };

    match signer
        .sign_partial(
            &request.session_id,
            &request.group_pubkey,
            &message,
            &request.all_commitments,
            request.guardian_assertion.as_deref(),
        )
        .await
    {
        Ok(response) => HttpResponse::Ok().json(response),
        Err(e) => {
            tracing::error!(error = %e, "Signer partial signature generation failed");
            e.error_response()
        }
    }
}

/// GET /signer/keys
///
/// List all key shares held by this signer.
#[tracing::instrument(skip(signer))]
pub async fn list_keys(signer: web::Data<SignerService>) -> HttpResponse {
    match signer.list_key_shares() {
        Ok(keys) => HttpResponse::Ok().json(serde_json::json!({
            "signer_id": signer.participant_id(),
            "keys": keys
        })),
        Err(e) => {
            tracing::error!(error = %e, "Failed to list key shares");
            e.error_response()
        }
    }
}

/// GET /signer/info
///
/// Get signer information.
#[tracing::instrument(skip(signer))]
pub async fn info(signer: web::Data<SignerService>) -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "participant_id": signer.participant_id(),
        "hpke_pubkey": signer.hpke_pubkey_base64()
    }))
}

/// Configure signer routes on the given scope.
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/signer")
            .route("/info", web::get().to(info))
            .route("/keys", web::get().to(list_keys))
            .route("/dkg/round1", web::post().to(dkg_round1))
            .route("/dkg/round2", web::post().to(dkg_round2))
            .route("/dkg/finalize", web::post().to(dkg_finalize))
            .route("/sign/commit", web::post().to(sign_commit))
            .route("/sign/partial", web::post().to(sign_partial)),
    );
}

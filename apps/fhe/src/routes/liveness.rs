//! Liveness threshold verification endpoint.

use serde::{Deserialize, Serialize};
use tracing::info_span;

use super::run_cpu_bound;
use crate::crypto;
use crate::error::FheError;
use crate::transport::MsgPack;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdRequest {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    /// Minimum required score (0.0 to 1.0)
    threshold: f64,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyLivenessThresholdResponse {
    #[serde(with = "serde_bytes")]
    passes_ciphertext: Vec<u8>,
    threshold: f64,
}

#[tracing::instrument(skip_all)]
pub async fn verify_liveness_threshold(
    MsgPack(payload): MsgPack<VerifyLivenessThresholdRequest>,
) -> Result<MsgPack<VerifyLivenessThresholdResponse>, FheError> {
    let VerifyLivenessThresholdRequest {
        ciphertext,
        threshold,
        key_id,
    } = payload;
    let ciphertext_bytes = ciphertext.len();
    let passes_ciphertext = run_cpu_bound(move || {
        info_span!(
            "fhe.verify.liveness_threshold",
            key_id = %key_id,
            threshold = %threshold,
            ciphertext_bytes = ciphertext_bytes
        )
        .in_scope(|| crypto::verify_liveness_threshold(&ciphertext, threshold, &key_id))
    })
    .await?;

    Ok(MsgPack(VerifyLivenessThresholdResponse {
        passes_ciphertext,
        threshold,
    }))
}

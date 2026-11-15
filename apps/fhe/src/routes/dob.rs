//! Age verification on encrypted date of birth (`dobDays`).

use serde::{Deserialize, Serialize};
use tracing::info_span;

use super::run_cpu_bound;
use crate::crypto;
use crate::error::FheError;
use crate::transport::MsgPack;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeFromDobRequest {
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
    /// Today's date as days since 1900-01-01 (UTC)
    current_days: u32,
    #[serde(default = "default_min_age")]
    min_age: u16,
    key_id: String,
}

fn default_min_age() -> u16 {
    18
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyAgeFromDobResponse {
    #[serde(with = "serde_bytes")]
    result_ciphertext: Vec<u8>,
}

#[tracing::instrument(skip_all)]
pub async fn verify_age_from_dob(
    MsgPack(payload): MsgPack<VerifyAgeFromDobRequest>,
) -> Result<MsgPack<VerifyAgeFromDobResponse>, FheError> {
    let VerifyAgeFromDobRequest {
        ciphertext,
        current_days,
        min_age,
        key_id,
    } = payload;
    let ciphertext_bytes = ciphertext.len();
    let result_ciphertext = run_cpu_bound(move || {
        info_span!(
            "fhe.verify.age_from_dob",
            key_id = %key_id,
            current_days = current_days,
            min_age = min_age,
            ciphertext_bytes = ciphertext_bytes
        )
        .in_scope(|| crypto::verify_age_from_dob(&ciphertext, current_days, min_age, &key_id))
    })
    .await?;

    Ok(MsgPack(VerifyAgeFromDobResponse { result_ciphertext }))
}

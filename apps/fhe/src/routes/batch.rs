//! Batch encryption endpoint for multiple attributes.

use std::sync::Arc;
use std::thread;

use axum::body::Bytes;
use axum::http::HeaderMap;
use axum::response::Response;
use serde::{Deserialize, Serialize};
use serde_bytes::ByteBuf;
use tracing::info_span;

use super::run_cpu_bound;
use crate::crypto;
use crate::error::FheError;
use crate::transport;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBatchRequest {
    key_id: String,
    /// Full DOB as days since 1900-01-01 (UTC)
    dob_days: Option<u32>,
    country_code: Option<u16>,
    compliance_level: Option<u8>,
    liveness_score: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptBatchResponse {
    /// Encrypted DOB days
    dob_days_ciphertext: Option<ByteBuf>,
    country_code_ciphertext: Option<ByteBuf>,
    compliance_level_ciphertext: Option<ByteBuf>,
    liveness_score_ciphertext: Option<ByteBuf>,
}

#[tracing::instrument(skip(headers, body), fields(request_bytes = body.len()))]
pub async fn encrypt_batch(headers: HeaderMap, body: Bytes) -> Result<Response, FheError> {
    let payload: EncryptBatchRequest = transport::decode_msgpack(&headers, body)?;

    if payload.dob_days.is_none()
        && payload.country_code.is_none()
        && payload.compliance_level.is_none()
        && payload.liveness_score.is_none()
    {
        return Err(FheError::InvalidInput(
            "At least one attribute must be provided".to_string(),
        ));
    }

    let EncryptBatchRequest {
        key_id,
        dob_days,
        country_code,
        compliance_level,
        liveness_score,
    } = payload;

    let response = run_cpu_bound(move || {
        let public_key = Arc::new(
            info_span!("fhe.get_public_key", key_id = %key_id)
                .in_scope(|| crypto::get_public_key_for_encryption(&key_id))?,
        );

        // Run all encryption operations in parallel using scoped threads
        let (dob_days_result, country_code_result, compliance_level_result, liveness_score_result) =
            info_span!("fhe.encrypt.parallel").in_scope(|| {
                thread::scope(|s| {
                    // Spawn thread for DOB days encryption
                    let pk = Arc::clone(&public_key);
                    let dob_days_handle = s.spawn(move || {
                        dob_days
                            .map(|value| {
                                info_span!("fhe.encrypt.dob_days", value = value)
                                    .in_scope(|| crypto::encrypt_dob_days(value, &pk))
                            })
                            .transpose()
                    });

                    // Spawn thread for country code encryption
                    let pk = Arc::clone(&public_key);
                    let country_code_handle = s.spawn(move || {
                        country_code
                            .map(|value| {
                                info_span!("fhe.encrypt.country_code", value = value)
                                    .in_scope(|| crypto::encrypt_country_code(value, &pk))
                            })
                            .transpose()
                    });

                    // Spawn thread for compliance level encryption
                    let pk = Arc::clone(&public_key);
                    let compliance_level_handle = s.spawn(move || {
                        compliance_level
                            .map(|value| {
                                info_span!("fhe.encrypt.compliance_level", value = value)
                                    .in_scope(|| crypto::encrypt_compliance_level(value, &pk))
                            })
                            .transpose()
                    });

                    // Spawn thread for liveness score encryption
                    let pk = Arc::clone(&public_key);
                    let liveness_score_handle = s.spawn(move || {
                        liveness_score
                            .map(|value| {
                                info_span!("fhe.encrypt.liveness_score", value = %value)
                                    .in_scope(|| crypto::encrypt_liveness_score(value, &pk))
                            })
                            .transpose()
                    });

                    // Join all threads and collect results
                    (
                        dob_days_handle.join().expect("dob_days thread panicked"),
                        country_code_handle
                            .join()
                            .expect("country_code thread panicked"),
                        compliance_level_handle
                            .join()
                            .expect("compliance_level thread panicked"),
                        liveness_score_handle
                            .join()
                            .expect("liveness_score thread panicked"),
                    )
                })
            });

        // Propagate any encryption errors
        let dob_days_ciphertext = dob_days_result?.map(ByteBuf::from);
        let country_code_ciphertext = country_code_result?.map(ByteBuf::from);
        let compliance_level_ciphertext = compliance_level_result?.map(ByteBuf::from);
        let liveness_score_ciphertext = liveness_score_result?.map(ByteBuf::from);

        Ok(EncryptBatchResponse {
            dob_days_ciphertext,
            country_code_ciphertext,
            compliance_level_ciphertext,
            liveness_score_ciphertext,
        })
    })
    .await?;

    transport::encode_msgpack(&headers, &response)
}

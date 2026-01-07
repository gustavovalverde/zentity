//! Integration tests for FROST DKG and signing.
//!
//! These tests exercise the full DKG and signing flow using the actual
//! Coordinator and `SignerService` types with temporary file-based databases.
//!
//! Run with: cargo test --test `frost_integration`

use std::collections::HashMap;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use tempfile::TempDir;

use signer_service::config::{Ciphersuite, Settings};
use signer_service::frost::{
    Coordinator, DkgInitRequest, DkgRound1Request, DkgRound2Request, SignerService,
    SigningAggregateRequest, SigningCommitRequest, SigningInitRequest, SigningSubmitPartialRequest,
};
use signer_service::storage::Storage;

/// Create a test coordinator with temporary storage.
fn create_test_coordinator(temp_dir: &TempDir) -> Coordinator {
    let db_path = temp_dir.path().join("coordinator.redb");
    let storage = Storage::open(&db_path).expect("Failed to create storage");
    let settings = Settings::for_coordinator_tests();
    Coordinator::new(storage, &settings).expect("Failed to create coordinator")
}

/// Create a test signer with temporary storage.
fn create_test_signer(temp_dir: &TempDir, signer_id: &str, participant_id: u16) -> SignerService {
    let db_path = temp_dir.path().join(format!("{signer_id}.redb"));
    let storage = Storage::open(&db_path).expect("Failed to create storage");
    SignerService::new(storage, signer_id.to_string(), participant_id)
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn test_full_dkg_and_signing_flow() {
    // Create temporary directories for storage
    let coord_dir = TempDir::new().unwrap();
    let signer1_dir = TempDir::new().unwrap();
    let signer2_dir = TempDir::new().unwrap();
    let signer3_dir = TempDir::new().unwrap();

    // Create services
    let coordinator = create_test_coordinator(&coord_dir);
    let signer1 = create_test_signer(&signer1_dir, "signer-1", 1);
    let signer2 = create_test_signer(&signer2_dir, "signer-2", 2);
    let signer3 = create_test_signer(&signer3_dir, "signer-3", 3);

    // Get HPKE public keys from signers
    let hpke1 = signer1.hpke_pubkey_base64();
    let hpke2 = signer2.hpke_pubkey_base64();
    let hpke3 = signer3.hpke_pubkey_base64();

    // ===== DKG Phase =====

    // 1. Initialize DKG session
    let mut participant_endpoints = HashMap::new();
    participant_endpoints.insert(1, "http://localhost:5101".to_string());
    participant_endpoints.insert(2, "http://localhost:5102".to_string());
    participant_endpoints.insert(3, "http://localhost:5103".to_string());

    let mut participant_hpke_pubkeys = HashMap::new();
    participant_hpke_pubkeys.insert(1, hpke1.clone());
    participant_hpke_pubkeys.insert(2, hpke2.clone());
    participant_hpke_pubkeys.insert(3, hpke3.clone());

    let init_resp = coordinator
        .init_dkg(DkgInitRequest {
            threshold: 2,
            total_participants: 3,
            ciphersuite: Ciphersuite::default(),
            participant_endpoints: Some(participant_endpoints),
            participant_hpke_pubkeys: participant_hpke_pubkeys.clone(),
        })
        .await
        .expect("DKG init failed");

    let session_id = init_resp.session_id;
    assert_eq!(init_resp.state.to_string(), "awaiting_round1");

    // 2. Get round 1 packages from each signer
    let r1_resp1 = signer1
        .dkg_round1(&session_id, 2, 3)
        .expect("Signer 1 round1 failed");

    let r1_resp2 = signer2
        .dkg_round1(&session_id, 2, 3)
        .expect("Signer 2 round1 failed");

    let r1_resp3 = signer3
        .dkg_round1(&session_id, 2, 3)
        .expect("Signer 3 round1 failed");

    // 3. Submit round 1 packages to coordinator
    coordinator
        .submit_round1(DkgRound1Request {
            session_id,
            participant_id: 1,
            package: r1_resp1.package.clone(),
        })
        .await
        .expect("Submit round1 p1 failed");

    coordinator
        .submit_round1(DkgRound1Request {
            session_id,
            participant_id: 2,
            package: r1_resp2.package.clone(),
        })
        .await
        .expect("Submit round1 p2 failed");

    let r1_final = coordinator
        .submit_round1(DkgRound1Request {
            session_id,
            participant_id: 3,
            package: r1_resp3.package.clone(),
        })
        .await
        .expect("Submit round1 p3 failed");

    assert_eq!(r1_final.state.to_string(), "awaiting_round2");

    // Build round1_packages map for signers
    let mut round1_packages = HashMap::new();
    round1_packages.insert(1, r1_resp1.package.clone());
    round1_packages.insert(2, r1_resp2.package.clone());
    round1_packages.insert(3, r1_resp3.package.clone());

    // 4. Get round 2 packages from each signer
    let r2_resp1 = signer1
        .dkg_round2(&session_id, &round1_packages, &participant_hpke_pubkeys)
        .expect("Signer 1 round2 failed");

    let r2_resp2 = signer2
        .dkg_round2(&session_id, &round1_packages, &participant_hpke_pubkeys)
        .expect("Signer 2 round2 failed");

    let r2_resp3 = signer3
        .dkg_round2(&session_id, &round1_packages, &participant_hpke_pubkeys)
        .expect("Signer 3 round2 failed");

    // 5. Submit round 2 packages to coordinator
    for (from, r2_resp) in [(1u16, &r2_resp1), (2, &r2_resp2), (3, &r2_resp3)] {
        for (&to, pkg) in &r2_resp.packages {
            coordinator
                .submit_round2(DkgRound2Request {
                    session_id,
                    from_participant_id: from,
                    to_participant_id: to,
                    encrypted_package: pkg.clone(),
                })
                .await
                .unwrap_or_else(|_| panic!("Submit r2 {from}->{to}  failed"));
        }
    }

    // 6. Finalize DKG on each signer
    let mut r2_for_1 = HashMap::new();
    r2_for_1.insert(2, r2_resp2.packages.get(&1).unwrap().clone());
    r2_for_1.insert(3, r2_resp3.packages.get(&1).unwrap().clone());

    let mut r2_for_2 = HashMap::new();
    r2_for_2.insert(1, r2_resp1.packages.get(&2).unwrap().clone());
    r2_for_2.insert(3, r2_resp3.packages.get(&2).unwrap().clone());

    let mut r2_for_3 = HashMap::new();
    r2_for_3.insert(1, r2_resp1.packages.get(&3).unwrap().clone());
    r2_for_3.insert(2, r2_resp2.packages.get(&3).unwrap().clone());

    let fin1 = signer1
        .dkg_finalize(&session_id, &round1_packages, &r2_for_1)
        .expect("Signer 1 finalize failed");

    let fin2 = signer2
        .dkg_finalize(&session_id, &round1_packages, &r2_for_2)
        .expect("Signer 2 finalize failed");

    let fin3 = signer3
        .dkg_finalize(&session_id, &round1_packages, &r2_for_3)
        .expect("Signer 3 finalize failed");

    // All signers should derive the same group public key
    assert_eq!(
        fin1.group_pubkey, fin2.group_pubkey,
        "Group pubkey mismatch 1-2"
    );
    assert_eq!(
        fin1.group_pubkey, fin3.group_pubkey,
        "Group pubkey mismatch 1-3"
    );

    let group_pubkey = fin1.group_pubkey;
    assert!(!group_pubkey.is_empty(), "Group pubkey should not be empty");

    println!(
        "DKG completed. Group pubkey: {}...",
        &group_pubkey[..64.min(group_pubkey.len())]
    );

    // ===== Signing Phase =====

    // 1. Initialize signing session
    let message = BASE64.encode("Hello FROST!");
    let sign_init = coordinator
        .init_signing(SigningInitRequest {
            group_pubkey: group_pubkey.clone(),
            message: message.clone(),
            selected_signers: Some(vec![1, 2]),
        })
        .await
        .expect("Signing init failed");

    let sign_session = sign_init.session_id;
    assert_eq!(sign_init.state.to_string(), "awaiting_commitments");

    // 2. Get commitments from selected signers
    let commit1 = signer1
        .sign_commit(&sign_session, &group_pubkey, None)
        .await
        .expect("Signer 1 commit failed");

    let commit2 = signer2
        .sign_commit(&sign_session, &group_pubkey, None)
        .await
        .expect("Signer 2 commit failed");

    // 3. Submit commitments to coordinator
    coordinator
        .submit_commitment(SigningCommitRequest {
            session_id: sign_session,
            participant_id: 1,
            commitment: commit1.commitment.clone(),
        })
        .await
        .expect("Submit commit 1 failed");

    let commit_resp = coordinator
        .submit_commitment(SigningCommitRequest {
            session_id: sign_session,
            participant_id: 2,
            commitment: commit2.commitment.clone(),
        })
        .await
        .expect("Submit commit 2 failed");

    assert_eq!(commit_resp.state.to_string(), "awaiting_partials");

    // 4. Generate partial signatures
    let mut all_commitments = HashMap::new();
    all_commitments.insert(1, commit1.commitment.clone());
    all_commitments.insert(2, commit2.commitment.clone());

    let message_bytes = BASE64.decode(&message).unwrap();

    let partial1 = signer1
        .sign_partial(
            &sign_session,
            &group_pubkey,
            &message_bytes,
            &all_commitments,
            None,
        )
        .await
        .expect("Signer 1 partial failed");

    let partial2 = signer2
        .sign_partial(
            &sign_session,
            &group_pubkey,
            &message_bytes,
            &all_commitments,
            None,
        )
        .await
        .expect("Signer 2 partial failed");

    // 5. Submit partial signatures to coordinator
    coordinator
        .submit_partial(SigningSubmitPartialRequest {
            session_id: sign_session,
            participant_id: 1,
            partial_signature: partial1.partial_signature.clone(),
        })
        .await
        .expect("Submit partial 1 failed");

    let partial_resp = coordinator
        .submit_partial(SigningSubmitPartialRequest {
            session_id: sign_session,
            participant_id: 2,
            partial_signature: partial2.partial_signature.clone(),
        })
        .await
        .expect("Submit partial 2 failed");

    assert!(partial_resp.partials_complete, "Should have all partials");

    // 6. Aggregate signatures
    let agg_resp = coordinator
        .aggregate_signatures(SigningAggregateRequest {
            session_id: sign_session,
        })
        .await
        .expect("Aggregation failed");

    assert_eq!(agg_resp.state.to_string(), "completed");
    assert!(agg_resp.signature.is_some(), "Should have final signature");

    let signature = agg_resp.signature.unwrap();
    println!(
        "Signing completed. Signature: {}...",
        &signature[..64.min(signature.len())]
    );
}

#[tokio::test]
async fn test_dkg_with_3_of_3_threshold() {
    let coord_dir = TempDir::new().unwrap();
    let signer1_dir = TempDir::new().unwrap();
    let signer2_dir = TempDir::new().unwrap();
    let signer3_dir = TempDir::new().unwrap();

    let coordinator = create_test_coordinator(&coord_dir);
    let signer1 = create_test_signer(&signer1_dir, "signer-1", 1);
    let signer2 = create_test_signer(&signer2_dir, "signer-2", 2);
    let signer3 = create_test_signer(&signer3_dir, "signer-3", 3);

    let mut participant_endpoints = HashMap::new();
    participant_endpoints.insert(1, "http://localhost:5101".to_string());
    participant_endpoints.insert(2, "http://localhost:5102".to_string());
    participant_endpoints.insert(3, "http://localhost:5103".to_string());

    let mut participant_hpke_pubkeys = HashMap::new();
    participant_hpke_pubkeys.insert(1, signer1.hpke_pubkey_base64());
    participant_hpke_pubkeys.insert(2, signer2.hpke_pubkey_base64());
    participant_hpke_pubkeys.insert(3, signer3.hpke_pubkey_base64());

    // Initialize with 3-of-3 threshold
    let init_resp = coordinator
        .init_dkg(DkgInitRequest {
            threshold: 3,
            total_participants: 3,
            ciphersuite: Ciphersuite::default(),
            participant_endpoints: Some(participant_endpoints),
            participant_hpke_pubkeys,
        })
        .await
        .expect("DKG init failed for 3-of-3");

    assert_eq!(init_resp.state.to_string(), "awaiting_round1");
}

#[tokio::test]
async fn test_invalid_participant_rejected() {
    let coord_dir = TempDir::new().unwrap();
    let signer1_dir = TempDir::new().unwrap();
    let signer2_dir = TempDir::new().unwrap();
    let signer3_dir = TempDir::new().unwrap();

    let coordinator = create_test_coordinator(&coord_dir);
    let signer1 = create_test_signer(&signer1_dir, "signer-1", 1);
    let signer2 = create_test_signer(&signer2_dir, "signer-2", 2);
    let signer3 = create_test_signer(&signer3_dir, "signer-3", 3);

    let mut participant_endpoints = HashMap::new();
    participant_endpoints.insert(1, "http://localhost:5101".to_string());
    participant_endpoints.insert(2, "http://localhost:5102".to_string());
    participant_endpoints.insert(3, "http://localhost:5103".to_string());

    let mut participant_hpke_pubkeys = HashMap::new();
    participant_hpke_pubkeys.insert(1, signer1.hpke_pubkey_base64());
    participant_hpke_pubkeys.insert(2, signer2.hpke_pubkey_base64());
    participant_hpke_pubkeys.insert(3, signer3.hpke_pubkey_base64());

    let init_resp = coordinator
        .init_dkg(DkgInitRequest {
            threshold: 2,
            total_participants: 3,
            ciphersuite: Ciphersuite::default(),
            participant_endpoints: Some(participant_endpoints),
            participant_hpke_pubkeys,
        })
        .await
        .expect("DKG init failed");

    // Try to submit round1 from participant 99 (invalid)
    let result = coordinator
        .submit_round1(DkgRound1Request {
            session_id: init_resp.session_id,
            participant_id: 99,
            package: "invalid".to_string(),
        })
        .await;

    assert!(result.is_err(), "Should reject invalid participant");
    let err = result.unwrap_err();
    assert!(
        err.to_string().contains("not in session"),
        "Error should mention participant not in session: {err}"
    );
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn test_signing_with_different_signer_subset() {
    // DKG with 3 signers, sign with signers 2 and 3 (not 1)
    let coord_dir = TempDir::new().unwrap();
    let signer1_dir = TempDir::new().unwrap();
    let signer2_dir = TempDir::new().unwrap();
    let signer3_dir = TempDir::new().unwrap();

    let coordinator = create_test_coordinator(&coord_dir);
    let signer1 = create_test_signer(&signer1_dir, "signer-1", 1);
    let signer2 = create_test_signer(&signer2_dir, "signer-2", 2);
    let signer3 = create_test_signer(&signer3_dir, "signer-3", 3);

    // Setup participants
    let mut participant_endpoints = HashMap::new();
    participant_endpoints.insert(1, "http://localhost:5101".to_string());
    participant_endpoints.insert(2, "http://localhost:5102".to_string());
    participant_endpoints.insert(3, "http://localhost:5103".to_string());

    let mut participant_hpke_pubkeys = HashMap::new();
    participant_hpke_pubkeys.insert(1, signer1.hpke_pubkey_base64());
    participant_hpke_pubkeys.insert(2, signer2.hpke_pubkey_base64());
    participant_hpke_pubkeys.insert(3, signer3.hpke_pubkey_base64());

    // Complete DKG with all 3 signers
    let init = coordinator
        .init_dkg(DkgInitRequest {
            threshold: 2,
            total_participants: 3,
            ciphersuite: Ciphersuite::default(),
            participant_endpoints: Some(participant_endpoints),
            participant_hpke_pubkeys: participant_hpke_pubkeys.clone(),
        })
        .await
        .unwrap();

    let session_id = init.session_id;

    // Round 1
    let r1_1 = signer1.dkg_round1(&session_id, 2, 3).unwrap();
    let r1_2 = signer2.dkg_round1(&session_id, 2, 3).unwrap();
    let r1_3 = signer3.dkg_round1(&session_id, 2, 3).unwrap();

    let mut round1_packages = HashMap::new();
    round1_packages.insert(1, r1_1.package.clone());
    round1_packages.insert(2, r1_2.package.clone());
    round1_packages.insert(3, r1_3.package.clone());

    coordinator
        .submit_round1(DkgRound1Request {
            session_id,
            participant_id: 1,
            package: r1_1.package.clone(),
        })
        .await
        .unwrap();
    coordinator
        .submit_round1(DkgRound1Request {
            session_id,
            participant_id: 2,
            package: r1_2.package.clone(),
        })
        .await
        .unwrap();
    coordinator
        .submit_round1(DkgRound1Request {
            session_id,
            participant_id: 3,
            package: r1_3.package.clone(),
        })
        .await
        .unwrap();

    // Round 2
    let r2_1 = signer1
        .dkg_round2(&session_id, &round1_packages, &participant_hpke_pubkeys)
        .unwrap();
    let r2_2 = signer2
        .dkg_round2(&session_id, &round1_packages, &participant_hpke_pubkeys)
        .unwrap();
    let r2_3 = signer3
        .dkg_round2(&session_id, &round1_packages, &participant_hpke_pubkeys)
        .unwrap();

    // Submit all round2 packages
    for (from, r2_resp) in [(1u16, &r2_1), (2, &r2_2), (3, &r2_3)] {
        for (&to, pkg) in &r2_resp.packages {
            coordinator
                .submit_round2(DkgRound2Request {
                    session_id,
                    from_participant_id: from,
                    to_participant_id: to,
                    encrypted_package: pkg.clone(),
                })
                .await
                .unwrap();
        }
    }

    // Finalize
    let mut r2_for_1 = HashMap::new();
    r2_for_1.insert(2, r2_2.packages.get(&1).unwrap().clone());
    r2_for_1.insert(3, r2_3.packages.get(&1).unwrap().clone());

    let mut r2_for_2 = HashMap::new();
    r2_for_2.insert(1, r2_1.packages.get(&2).unwrap().clone());
    r2_for_2.insert(3, r2_3.packages.get(&2).unwrap().clone());

    let mut r2_for_3 = HashMap::new();
    r2_for_3.insert(1, r2_1.packages.get(&3).unwrap().clone());
    r2_for_3.insert(2, r2_2.packages.get(&3).unwrap().clone());

    let fin1 = signer1
        .dkg_finalize(&session_id, &round1_packages, &r2_for_1)
        .unwrap();
    let _fin2 = signer2
        .dkg_finalize(&session_id, &round1_packages, &r2_for_2)
        .unwrap();
    let _fin3 = signer3
        .dkg_finalize(&session_id, &round1_packages, &r2_for_3)
        .unwrap();

    let group_pubkey = fin1.group_pubkey;

    // ===== Sign with signers 2 and 3 only =====
    let message = BASE64.encode("Signed by signers 2 and 3");
    let sign_init = coordinator
        .init_signing(SigningInitRequest {
            group_pubkey: group_pubkey.clone(),
            message: message.clone(),
            selected_signers: Some(vec![2, 3]), // Note: not signer 1
        })
        .await
        .unwrap();

    let sign_session = sign_init.session_id;

    // Commitments from signers 2 and 3
    let commit2 = signer2
        .sign_commit(&sign_session, &group_pubkey, None)
        .await
        .unwrap();
    let commit3 = signer3
        .sign_commit(&sign_session, &group_pubkey, None)
        .await
        .unwrap();

    coordinator
        .submit_commitment(SigningCommitRequest {
            session_id: sign_session,
            participant_id: 2,
            commitment: commit2.commitment.clone(),
        })
        .await
        .unwrap();
    coordinator
        .submit_commitment(SigningCommitRequest {
            session_id: sign_session,
            participant_id: 3,
            commitment: commit3.commitment.clone(),
        })
        .await
        .unwrap();

    // Partial signatures from signers 2 and 3
    let mut all_commitments = HashMap::new();
    all_commitments.insert(2, commit2.commitment.clone());
    all_commitments.insert(3, commit3.commitment.clone());

    let message_bytes = BASE64.decode(&message).unwrap();

    let partial2 = signer2
        .sign_partial(
            &sign_session,
            &group_pubkey,
            &message_bytes,
            &all_commitments,
            None,
        )
        .await
        .unwrap();
    let partial3 = signer3
        .sign_partial(
            &sign_session,
            &group_pubkey,
            &message_bytes,
            &all_commitments,
            None,
        )
        .await
        .unwrap();

    coordinator
        .submit_partial(SigningSubmitPartialRequest {
            session_id: sign_session,
            participant_id: 2,
            partial_signature: partial2.partial_signature,
        })
        .await
        .unwrap();
    coordinator
        .submit_partial(SigningSubmitPartialRequest {
            session_id: sign_session,
            participant_id: 3,
            partial_signature: partial3.partial_signature,
        })
        .await
        .unwrap();

    // Aggregate
    let agg = coordinator
        .aggregate_signatures(SigningAggregateRequest {
            session_id: sign_session,
        })
        .await
        .unwrap();

    assert_eq!(agg.state.to_string(), "completed");
    assert!(agg.signature.is_some());
    println!("Signing with 2+3 succeeded!");
}

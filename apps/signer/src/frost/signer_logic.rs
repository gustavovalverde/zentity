//! Signer logic for FROST key share operations.
//!
//! Each signer instance holds exactly one key share and performs:
//! - DKG participation (round 1/2 package generation, finalization)
//! - Signing commitment and partial signature generation
//!
//! Key shares are stored with envelope encryption (DEK wrapped by KEK).
//! The signer never exposes plaintext key material outside its process.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use frost_ed25519 as frost_ed;
use frost_secp256k1 as frost_secp;
// Use frost's re-exported rand_core (0.6.4) for FROST operations
use frost_secp::rand_core::OsRng;

use crate::config::Ciphersuite;
use crate::error::{SignerError, SignerResult};
use crate::frost::hpke_crypto::{self, HpkeKeyPair};
use crate::frost::jwt_verification::JwtVerifier;
use crate::frost::macros::{
    impl_dkg_finalize, impl_dkg_round1, impl_dkg_round2, impl_sign_commit, impl_sign_partial,
};
use crate::frost::types::{
    ParticipantId, SessionId, SignerCommitResponse, SignerDkgFinalizeResponse,
    SignerDkgRound1Response, SignerDkgRound2Response, SignerPartialSignResponse,
};
use crate::storage::Storage;

#[derive(Clone)]
struct StoredSecret {
    ciphersuite: Ciphersuite,
    bytes: Vec<u8>,
}

#[derive(Clone)]
struct StoredNonces {
    ciphersuite: Ciphersuite,
    bytes: Vec<u8>,
}

/// Signer service for FROST key share operations.
pub struct SignerService {
    storage: Storage,
    signer_id: String,
    participant_id: ParticipantId,
    ciphersuite: Ciphersuite,
    /// HPKE key pair for receiving encrypted DKG round-2 shares.
    hpke_keypair: HpkeKeyPair,
    /// In-memory DKG state (cleared after finalization).
    /// Maps session_id -> DKG round 1 secret package.
    dkg_round1_secrets: Mutex<HashMap<String, StoredSecret>>,
    /// In-memory signing nonces (cleared after use).
    /// Maps (group_pubkey, session_id) -> nonces.
    signing_nonces: Mutex<HashMap<(String, String), StoredNonces>>,
    /// Optional JWT verifier for guardian assertions.
    jwt_verifier: Option<JwtVerifier>,
}

impl SignerService {
    /// Create a new signer service.
    pub fn new(
        storage: Storage,
        signer_id: String,
        participant_id: ParticipantId,
        ciphersuite: Ciphersuite,
    ) -> Self {
        Self {
            storage,
            signer_id,
            participant_id,
            ciphersuite,
            hpke_keypair: HpkeKeyPair::generate(),
            dkg_round1_secrets: Mutex::new(HashMap::new()),
            signing_nonces: Mutex::new(HashMap::new()),
            jwt_verifier: None,
        }
    }

    /// Create a new signer service with JWT verification enabled.
    pub fn with_jwt_verification(
        storage: Storage,
        signer_id: String,
        participant_id: ParticipantId,
        ciphersuite: Ciphersuite,
        jwks_url: String,
    ) -> Self {
        Self {
            storage,
            signer_id,
            participant_id,
            ciphersuite,
            hpke_keypair: HpkeKeyPair::generate(),
            dkg_round1_secrets: Mutex::new(HashMap::new()),
            signing_nonces: Mutex::new(HashMap::new()),
            jwt_verifier: Some(JwtVerifier::new(jwks_url)),
        }
    }

    /// Check if JWT verification is enabled.
    pub fn jwt_verification_enabled(&self) -> bool {
        self.jwt_verifier.is_some()
    }

    /// Get this signer's participant ID.
    pub fn participant_id(&self) -> ParticipantId {
        self.participant_id
    }

    /// Get this signer's HPKE public key (base64).
    pub fn hpke_pubkey_base64(&self) -> String {
        self.hpke_keypair.public_key_base64()
    }

    /// Get this signer's configured ciphersuite.
    pub fn ciphersuite(&self) -> Ciphersuite {
        self.ciphersuite
    }

    fn share_key(&self, group_pubkey: &str) -> String {
        format!(
            "{}:{}:{}",
            self.ciphersuite, group_pubkey, self.participant_id
        )
    }

    fn pubkey_package_key(&self, group_pubkey: &str) -> String {
        format!("{}:{}:pubkey_package", self.ciphersuite, group_pubkey)
    }

    fn store_round1_secret(&self, session_key: String, secret_bytes: Vec<u8>) -> SignerResult<()> {
        self.dkg_round1_secrets
            .lock()
            .map_err(|e| SignerError::Internal(format!("DKG state mutex poisoned: {e}")))?
            .insert(
                session_key,
                StoredSecret {
                    ciphersuite: self.ciphersuite,
                    bytes: secret_bytes,
                },
            );
        Ok(())
    }

    fn take_round1_secret(&self, session_key: &str) -> SignerResult<StoredSecret> {
        let mut secrets = self
            .dkg_round1_secrets
            .lock()
            .map_err(|e| SignerError::Internal(format!("DKG state mutex poisoned: {e}")))?;
        secrets.remove(session_key).ok_or_else(|| {
            SignerError::SessionNotFound(format!("No round 1 secret for session {session_key}"))
        })
    }

    fn store_signing_nonces(
        &self,
        nonces_key: (String, String),
        nonces_bytes: Vec<u8>,
    ) -> SignerResult<()> {
        let mut map = self
            .signing_nonces
            .lock()
            .map_err(|e| SignerError::Internal(format!("Signing nonces mutex poisoned: {e}")))?;

        if map.contains_key(&nonces_key) {
            return Err(SignerError::NoncesAlreadyExist {
                group_pubkey: nonces_key.0,
                session_id: nonces_key.1,
            });
        }

        map.insert(
            nonces_key,
            StoredNonces {
                ciphersuite: self.ciphersuite,
                bytes: nonces_bytes,
            },
        );
        drop(map);
        Ok(())
    }

    fn take_signing_nonces(&self, nonces_key: &(String, String)) -> SignerResult<StoredNonces> {
        let mut nonces_map = self
            .signing_nonces
            .lock()
            .map_err(|e| SignerError::Internal(format!("Signing nonces mutex poisoned: {e}")))?;
        nonces_map.remove(nonces_key).ok_or_else(|| {
            SignerError::SessionNotFound(format!(
                "No nonces for session {} group {}",
                nonces_key.1, nonces_key.0
            ))
        })
    }

    // =========================================================================
    // DKG Operations
    // =========================================================================

    /// Generate DKG round 1 package.
    ///
    /// Creates a secret polynomial and commitment, returning the public package
    /// to be shared with other participants.
    pub fn dkg_round1(
        &self,
        session_id: &SessionId,
        threshold: u16,
        total_participants: u16,
    ) -> SignerResult<SignerDkgRound1Response> {
        match self.ciphersuite {
            Ciphersuite::Secp256k1 => {
                self.dkg_round1_secp(session_id, threshold, total_participants)
            }
            Ciphersuite::Ed25519 => self.dkg_round1_ed(session_id, threshold, total_participants),
        }
    }

    // Generate ciphersuite-specific implementations via macros
    impl_dkg_round1!(dkg_round1_secp, frost_secp);
    impl_dkg_round1!(dkg_round1_ed, frost_ed);

    /// Generate DKG round 2 packages.
    ///
    /// Takes all round 1 packages and produces encrypted round 2 packages
    /// for each other participant.
    pub fn dkg_round2(
        &self,
        session_id: &SessionId,
        round1_packages: &HashMap<ParticipantId, String>,
        participant_hpke_pubkeys: &HashMap<ParticipantId, String>,
    ) -> SignerResult<SignerDkgRound2Response> {
        match self.ciphersuite {
            Ciphersuite::Secp256k1 => {
                self.dkg_round2_secp(session_id, round1_packages, participant_hpke_pubkeys)
            }
            Ciphersuite::Ed25519 => {
                self.dkg_round2_ed(session_id, round1_packages, participant_hpke_pubkeys)
            }
        }
    }

    impl_dkg_round2!(dkg_round2_secp, frost_secp);
    impl_dkg_round2!(dkg_round2_ed, frost_ed);

    /// Finalize DKG and store key share.
    ///
    /// Decrypts round 2 packages received from other participants,
    /// derives the key share, and stores it with envelope encryption.
    pub fn dkg_finalize(
        &self,
        session_id: &SessionId,
        round1_packages: &HashMap<ParticipantId, String>,
        round2_packages: &HashMap<ParticipantId, String>,
    ) -> SignerResult<SignerDkgFinalizeResponse> {
        match self.ciphersuite {
            Ciphersuite::Secp256k1 => {
                self.dkg_finalize_secp(session_id, round1_packages, round2_packages)
            }
            Ciphersuite::Ed25519 => {
                self.dkg_finalize_ed(session_id, round1_packages, round2_packages)
            }
        }
    }

    impl_dkg_finalize!(dkg_finalize_secp, frost_secp);
    impl_dkg_finalize!(dkg_finalize_ed, frost_ed);

    // =========================================================================
    // Signing Operations
    // =========================================================================

    /// Verify guardian assertion JWT if verification is enabled.
    async fn verify_guardian_assertion(
        &self,
        session_id: &SessionId,
        guardian_assertion: Option<&str>,
    ) -> SignerResult<()> {
        if let Some(verifier) = &self.jwt_verifier {
            let token = guardian_assertion.ok_or_else(|| {
                SignerError::InvalidGuardianAssertion(
                    "Guardian assertion required when JWT verification is enabled".to_string(),
                )
            })?;

            verifier
                .verify(token, &session_id.to_string(), self.participant_id)
                .await?;
        }
        Ok(())
    }

    /// Generate signing commitment.
    ///
    /// Creates nonces and commitment for a signing session.
    /// The nonces are stored temporarily and used when generating the partial signature.
    ///
    /// If JWT verification is enabled, `guardian_assertion` must contain a valid JWT.
    pub async fn sign_commit(
        &self,
        session_id: &SessionId,
        group_pubkey: &str,
        guardian_assertion: Option<&str>,
    ) -> SignerResult<SignerCommitResponse> {
        // Verify guardian assertion if JWT verification is enabled
        self.verify_guardian_assertion(session_id, guardian_assertion)
            .await?;

        match self.ciphersuite {
            Ciphersuite::Secp256k1 => self.sign_commit_secp(session_id, group_pubkey),
            Ciphersuite::Ed25519 => self.sign_commit_ed(session_id, group_pubkey),
        }
    }

    impl_sign_commit!(sign_commit_secp, frost_secp);
    impl_sign_commit!(sign_commit_ed, frost_ed);

    /// Generate partial signature.
    ///
    /// Uses the stored nonces and key share to produce a partial signature.
    ///
    /// If JWT verification is enabled, `guardian_assertion` must contain a valid JWT.
    pub async fn sign_partial(
        &self,
        session_id: &SessionId,
        group_pubkey: &str,
        message: &[u8],
        all_commitments: &HashMap<ParticipantId, String>,
        guardian_assertion: Option<&str>,
    ) -> SignerResult<SignerPartialSignResponse> {
        // Verify guardian assertion if JWT verification is enabled
        self.verify_guardian_assertion(session_id, guardian_assertion)
            .await?;

        match self.ciphersuite {
            Ciphersuite::Secp256k1 => {
                self.sign_partial_secp(session_id, group_pubkey, message, all_commitments)
            }
            Ciphersuite::Ed25519 => {
                self.sign_partial_ed(session_id, group_pubkey, message, all_commitments)
            }
        }
    }

    impl_sign_partial!(sign_partial_secp, frost_secp);
    impl_sign_partial!(sign_partial_ed, frost_ed);

    /// List all key shares stored by this signer.
    pub fn list_key_shares(&self) -> SignerResult<Vec<String>> {
        self.storage.list_key_share_keys()
    }

    /// Check if this signer has a key share for a group.
    pub fn has_key_share(&self, group_pubkey: &str) -> SignerResult<bool> {
        let share_key = self.share_key(group_pubkey);
        Ok(self.storage.get_key_share(&share_key)?.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_signer(id: &str, participant_id: ParticipantId) -> SignerService {
        let storage = Storage::open_memory().expect("Failed to create test storage");
        SignerService::new(
            storage,
            id.to_string(),
            participant_id,
            Ciphersuite::Secp256k1,
        )
    }

    #[test]
    fn test_signer_creation() {
        let signer = create_test_signer("signer-1", ParticipantId::new_unwrap(1));
        assert_eq!(signer.participant_id(), ParticipantId::new_unwrap(1));
        assert!(!signer.hpke_pubkey_base64().is_empty());
    }

    #[test]
    fn test_dkg_round1() {
        let signer = create_test_signer("signer-1", ParticipantId::new_unwrap(1));
        let session_id = uuid::Uuid::new_v4();

        let result = signer.dkg_round1(&session_id, 2, 3);
        assert!(result.is_ok());

        let response = result.unwrap();
        assert!(!response.package.is_empty());
        assert!(!response.hpke_pubkey.is_empty());
    }

    // Full DKG flow test would require multiple signers - will be tested in integration tests
}

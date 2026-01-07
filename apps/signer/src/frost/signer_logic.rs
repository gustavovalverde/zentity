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
use frost_secp256k1::{
    Identifier, SigningPackage,
    keys::{
        KeyPackage, PublicKeyPackage,
        dkg::{self, round1, round2},
    },
    round1::{SigningCommitments, SigningNonces},
};
// Use frost's re-exported rand_core (0.6.4) for FROST operations
use frost_secp256k1::rand_core::OsRng;

use crate::error::{SignerError, SignerResult};
use crate::frost::hpke_crypto::{self, HpkeKeyPair};
use crate::frost::jwt_verification::JwtVerifier;
use crate::frost::types::{
    ParticipantId, SessionId, SignerCommitResponse, SignerDkgFinalizeResponse,
    SignerDkgRound1Response, SignerDkgRound2Response, SignerPartialSignResponse,
};
use crate::storage::Storage;

/// Signer service for FROST key share operations.
pub struct SignerService {
    storage: Storage,
    signer_id: String,
    participant_id: ParticipantId,
    /// HPKE key pair for receiving encrypted DKG round-2 shares.
    hpke_keypair: HpkeKeyPair,
    /// In-memory DKG state (cleared after finalization).
    /// Maps session_id -> DKG round 1 secret package.
    dkg_round1_secrets: Mutex<HashMap<String, round1::SecretPackage>>,
    /// In-memory signing nonces (cleared after use).
    /// Maps (group_pubkey, session_id) -> nonces.
    signing_nonces: Mutex<HashMap<(String, String), SigningNonces>>,
    /// Optional JWT verifier for guardian assertions.
    jwt_verifier: Option<JwtVerifier>,
}

impl SignerService {
    /// Create a new signer service.
    pub fn new(storage: Storage, signer_id: String, participant_id: ParticipantId) -> Self {
        Self {
            storage,
            signer_id,
            participant_id,
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
        jwks_url: String,
    ) -> Self {
        Self {
            storage,
            signer_id,
            participant_id,
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
        let identifier = Identifier::try_from(self.participant_id)
            .map_err(|e| SignerError::InvalidParticipant(format!("Invalid identifier: {e}")))?;

        // Generate round 1 package
        let (round1_secret, round1_package) =
            dkg::part1(identifier, total_participants, threshold, OsRng)
                .map_err(|e| SignerError::DkgFailed(format!("Round 1 generation failed: {e}")))?;

        // Store secret for round 2
        let session_key = session_id.to_string();
        {
            let mut secrets = self
                .dkg_round1_secrets
                .lock()
                .map_err(|e| SignerError::Internal(format!("DKG state mutex poisoned: {e}")))?;
            secrets.insert(session_key, round1_secret);
        }

        // Serialize round 1 package
        let package_bytes = round1_package.serialize().map_err(|e| {
            SignerError::Serialization(format!("Failed to serialize round 1 package: {e}"))
        })?;

        tracing::info!(
            signer_id = %self.signer_id,
            session_id = %session_id,
            "Generated DKG round 1 package"
        );

        Ok(SignerDkgRound1Response {
            package: BASE64.encode(&package_bytes),
            hpke_pubkey: self.hpke_pubkey_base64(),
        })
    }

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
        let session_key = session_id.to_string();

        // Get round 1 secret
        let round1_secret = {
            let secrets = self
                .dkg_round1_secrets
                .lock()
                .map_err(|e| SignerError::Internal(format!("DKG state mutex poisoned: {e}")))?;
            secrets.get(&session_key).cloned().ok_or_else(|| {
                SignerError::SessionNotFound(format!("No round 1 secret for session {session_id}"))
            })?
        };

        // Decode round 1 packages from OTHER participants (not our own)
        let mut decoded_packages: BTreeMap<Identifier, round1::Package> = BTreeMap::new();
        for (&participant_id, package_b64) in round1_packages {
            // Skip our own round1 package - FROST expects only packages from other participants
            if participant_id == self.participant_id {
                continue;
            }

            let package_bytes = BASE64.decode(package_b64).map_err(|e| {
                SignerError::Deserialization(format!(
                    "Invalid round 1 package base64 for {participant_id}: {e}"
                ))
            })?;
            let identifier = Identifier::try_from(participant_id).map_err(|e| {
                SignerError::InvalidParticipant(format!("Invalid identifier {participant_id}: {e}"))
            })?;
            let package = round1::Package::deserialize(&package_bytes).map_err(|e| {
                SignerError::Deserialization(format!(
                    "Invalid round 1 package for {participant_id}: {e}"
                ))
            })?;
            decoded_packages.insert(identifier, package);
        }

        // Generate round 2 packages
        let (round2_secret, round2_packages) = dkg::part2(round1_secret, &decoded_packages)
            .map_err(|e| SignerError::DkgFailed(format!("Round 2 generation failed: {e}")))?;

        // Store round 2 secret for finalization
        // We need to store this somehow - let's store it in the same map but with a different key
        {
            let mut secrets = self
                .dkg_round1_secrets
                .lock()
                .map_err(|e| SignerError::Internal(format!("DKG state mutex poisoned: {e}")))?;
            // Remove round 1 secret (consumed)
            secrets.remove(&session_key);
            // Store round 2 secret with different key prefix
            // Note: round2_secret is a different type, so we can't store it the same way
            // We'll need to handle this differently in finalization
        }

        // Build reverse mapping from Identifier -> ParticipantId
        // We need this because Identifier::serialize() returns scalar bytes, not the original u16
        let mut identifier_to_participant: HashMap<Identifier, ParticipantId> = HashMap::new();
        for &participant_id in participant_hpke_pubkeys.keys() {
            if let Ok(id) = Identifier::try_from(participant_id) {
                identifier_to_participant.insert(id, participant_id);
            }
        }

        // Encrypt each round 2 package for its recipient
        let mut encrypted_packages: HashMap<ParticipantId, String> = HashMap::new();
        for (identifier, package) in round2_packages {
            let to_participant_id =
                *identifier_to_participant.get(&identifier).ok_or_else(|| {
                    SignerError::InvalidParticipant(format!(
                        "Unknown identifier in round2 packages: {identifier:?}"
                    ))
                })?;

            // Skip self
            if to_participant_id == self.participant_id {
                continue;
            }

            // Get recipient's HPKE public key
            let recipient_pubkey_b64 = participant_hpke_pubkeys
                .get(&to_participant_id)
                .ok_or_else(|| {
                    SignerError::InvalidParticipant(format!(
                        "No HPKE pubkey for participant {to_participant_id}"
                    ))
                })?;

            let recipient_pubkey = HpkeKeyPair::public_key_from_base64(recipient_pubkey_b64)?;

            // Serialize package
            let package_bytes = package.serialize().map_err(|e| {
                SignerError::Serialization(format!(
                    "Failed to serialize round 2 package for {to_participant_id}: {e}"
                ))
            })?;

            // Encrypt for recipient
            let info =
                hpke_crypto::dkg_round2_info(session_id, self.participant_id, to_participant_id);
            let encrypted =
                hpke_crypto::encrypt_to_base64(&recipient_pubkey, &package_bytes, &info)?;

            encrypted_packages.insert(to_participant_id, encrypted);
        }

        // Store round 2 secret package for finalization
        // We need to serialize and store it
        let round2_secret_bytes = round2_secret.serialize().map_err(|e| {
            SignerError::Serialization(format!("Failed to serialize round 2 secret: {e}"))
        })?;
        let round2_secret_key = format!("{session_key}_round2");
        self.storage
            .put_key_share(&round2_secret_key, &round2_secret_bytes)?;

        tracing::info!(
            signer_id = %self.signer_id,
            session_id = %session_id,
            recipients = ?encrypted_packages.keys().collect::<Vec<_>>(),
            "Generated DKG round 2 packages"
        );

        Ok(SignerDkgRound2Response {
            packages: encrypted_packages,
        })
    }

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
        let session_key = session_id.to_string();

        // Load round 2 secret
        let round2_secret_key = format!("{session_key}_round2");
        let round2_secret_bytes =
            self.storage
                .get_key_share(&round2_secret_key)?
                .ok_or_else(|| {
                    SignerError::SessionNotFound(format!(
                        "No round 2 secret for session {session_id}"
                    ))
                })?;
        let round2_secret = round2::SecretPackage::deserialize(&round2_secret_bytes)
            .map_err(|e| SignerError::Deserialization(format!("Invalid round 2 secret: {e}")))?;

        // Decode round 1 packages from OTHER participants (not our own)
        let mut decoded_round1: BTreeMap<Identifier, round1::Package> = BTreeMap::new();
        for (&participant_id, package_b64) in round1_packages {
            // Skip our own round1 package
            if participant_id == self.participant_id {
                continue;
            }

            let package_bytes = BASE64.decode(package_b64).map_err(|e| {
                SignerError::Deserialization(format!(
                    "Invalid round 1 package base64 for {participant_id}: {e}"
                ))
            })?;
            let identifier = Identifier::try_from(participant_id).map_err(|e| {
                SignerError::InvalidParticipant(format!("Invalid identifier {participant_id}: {e}"))
            })?;
            let package = round1::Package::deserialize(&package_bytes).map_err(|e| {
                SignerError::Deserialization(format!(
                    "Invalid round 1 package for {participant_id}: {e}"
                ))
            })?;
            decoded_round1.insert(identifier, package);
        }

        // Decrypt and decode round 2 packages
        let mut decoded_round2: BTreeMap<Identifier, round2::Package> = BTreeMap::new();
        for (&from_participant_id, encrypted_b64) in round2_packages {
            // Decrypt using our HPKE secret key
            let info =
                hpke_crypto::dkg_round2_info(session_id, from_participant_id, self.participant_id);
            let package_bytes = hpke_crypto::decrypt_from_base64(
                self.hpke_keypair.secret_key(),
                encrypted_b64,
                &info,
            )?;

            let identifier = Identifier::try_from(from_participant_id).map_err(|e| {
                SignerError::InvalidParticipant(format!(
                    "Invalid identifier {from_participant_id}: {e}"
                ))
            })?;
            let package = round2::Package::deserialize(&package_bytes).map_err(|e| {
                SignerError::Deserialization(format!(
                    "Invalid round 2 package from {from_participant_id}: {e}"
                ))
            })?;
            decoded_round2.insert(identifier, package);
        }

        // Finalize DKG
        let (key_package, pubkey_package) =
            dkg::part3(&round2_secret, &decoded_round1, &decoded_round2)
                .map_err(|e| SignerError::DkgFailed(format!("DKG finalization failed: {e}")))?;

        // Get group public key and verifying share
        let group_pubkey_bytes = pubkey_package.serialize().map_err(|e| {
            SignerError::Serialization(format!("Failed to serialize public key package: {e}"))
        })?;
        let group_pubkey = hex::encode(&group_pubkey_bytes);

        let verifying_share = pubkey_package
            .verifying_shares()
            .get(key_package.identifier())
            .ok_or_else(|| {
                SignerError::DkgFailed("Missing verifying share for this participant".to_string())
            })?;
        let verifying_share_bytes = verifying_share.serialize().map_err(|e| {
            SignerError::Serialization(format!("Failed to serialize verifying share: {e}"))
        })?;
        let verifying_share_hex = hex::encode(&verifying_share_bytes);

        // Store key package with envelope encryption
        // For now, use simple encryption. In production, use KMS.
        let key_package_bytes = key_package.serialize().map_err(|e| {
            SignerError::Serialization(format!("Failed to serialize key package: {e}"))
        })?;

        // Store with group pubkey as key (so we can find it later for signing)
        let share_key = format!("{}:{}", group_pubkey, self.participant_id);
        self.storage.put_key_share(&share_key, &key_package_bytes)?;

        // Also store the public key package for verification
        let pubkey_key = format!("{group_pubkey}_pubkey");
        self.storage
            .put_key_share(&pubkey_key, &group_pubkey_bytes)?;

        // Clean up temporary data
        self.storage.delete_key_share(&round2_secret_key)?;

        tracing::info!(
            signer_id = %self.signer_id,
            session_id = %session_id,
            group_pubkey = %group_pubkey,
            "DKG finalized, key share stored"
        );

        Ok(SignerDkgFinalizeResponse {
            group_pubkey,
            verifying_share: verifying_share_hex,
        })
    }

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

        // Load key package
        let share_key = format!("{}:{}", group_pubkey, self.participant_id);
        let key_package_bytes = self.storage.get_key_share(&share_key)?.ok_or_else(|| {
            SignerError::KeyShareNotFound(format!(
                "No key share for group {} participant {}",
                group_pubkey, self.participant_id
            ))
        })?;
        let key_package = KeyPackage::deserialize(&key_package_bytes)
            .map_err(|e| SignerError::Deserialization(format!("Invalid key package: {e}")))?;

        // Generate nonces and commitment
        let (nonces, commitments) =
            frost_secp256k1::round1::commit(key_package.signing_share(), &mut OsRng);

        // Store nonces for later use
        let nonces_key = (group_pubkey.to_string(), session_id.to_string());
        {
            let mut nonces_map = self.signing_nonces.lock().map_err(|e| {
                SignerError::Internal(format!("Signing nonces mutex poisoned: {e}"))
            })?;
            nonces_map.insert(nonces_key, nonces);
        }

        // Serialize commitment
        let commitment_bytes = commitments.serialize().map_err(|e| {
            SignerError::Serialization(format!("Failed to serialize commitment: {e}"))
        })?;

        tracing::info!(
            signer_id = %self.signer_id,
            session_id = %session_id,
            "Generated signing commitment"
        );

        Ok(SignerCommitResponse {
            commitment: BASE64.encode(&commitment_bytes),
        })
    }

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

        // Load key package
        let share_key = format!("{}:{}", group_pubkey, self.participant_id);
        let key_package_bytes = self.storage.get_key_share(&share_key)?.ok_or_else(|| {
            SignerError::KeyShareNotFound(format!(
                "No key share for group {} participant {}",
                group_pubkey, self.participant_id
            ))
        })?;
        let key_package = KeyPackage::deserialize(&key_package_bytes)
            .map_err(|e| SignerError::Deserialization(format!("Invalid key package: {e}")))?;

        // Load public key package
        let pubkey_key = format!("{group_pubkey}_pubkey");
        let pubkey_package_bytes = self.storage.get_key_share(&pubkey_key)?.ok_or_else(|| {
            SignerError::KeyShareNotFound(format!("No public key package for group {group_pubkey}"))
        })?;
        let _pubkey_package =
            PublicKeyPackage::deserialize(&pubkey_package_bytes).map_err(|e| {
                SignerError::Deserialization(format!("Invalid public key package: {e}"))
            })?;

        // Get stored nonces
        let nonces_key = (group_pubkey.to_string(), session_id.to_string());
        let nonces = {
            let mut nonces_map = self.signing_nonces.lock().map_err(|e| {
                SignerError::Internal(format!("Signing nonces mutex poisoned: {e}"))
            })?;
            nonces_map.remove(&nonces_key).ok_or_else(|| {
                SignerError::SessionNotFound(format!(
                    "No nonces for session {session_id} group {group_pubkey}"
                ))
            })?
        };

        // Decode all commitments
        let mut decoded_commitments: BTreeMap<Identifier, SigningCommitments> = BTreeMap::new();
        for (&participant_id, commitment_b64) in all_commitments {
            let commitment_bytes = BASE64.decode(commitment_b64).map_err(|e| {
                SignerError::Deserialization(format!(
                    "Invalid commitment base64 for {participant_id}: {e}"
                ))
            })?;
            let identifier = Identifier::try_from(participant_id).map_err(|e| {
                SignerError::InvalidParticipant(format!("Invalid identifier {participant_id}: {e}"))
            })?;
            let commitment = SigningCommitments::deserialize(&commitment_bytes).map_err(|e| {
                SignerError::Deserialization(format!(
                    "Invalid commitment for {participant_id}: {e}"
                ))
            })?;
            decoded_commitments.insert(identifier, commitment);
        }

        // Create signing package
        let signing_package = SigningPackage::new(decoded_commitments, message);

        // Generate partial signature
        let signature_share =
            frost_secp256k1::round2::sign(&signing_package, &nonces, &key_package).map_err(
                |e| SignerError::SigningFailed(format!("Partial signature generation failed: {e}")),
            )?;

        // Serialize (infallible for SignatureShare)
        let signature_share_bytes = signature_share.serialize();

        tracing::info!(
            signer_id = %self.signer_id,
            session_id = %session_id,
            "Generated partial signature"
        );

        Ok(SignerPartialSignResponse {
            partial_signature: BASE64.encode(&signature_share_bytes),
        })
    }

    /// List all key shares stored by this signer.
    pub fn list_key_shares(&self) -> SignerResult<Vec<String>> {
        self.storage.list_key_share_keys()
    }

    /// Check if this signer has a key share for a group.
    pub fn has_key_share(&self, group_pubkey: &str) -> SignerResult<bool> {
        let share_key = format!("{}:{}", group_pubkey, self.participant_id);
        Ok(self.storage.get_key_share(&share_key)?.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_signer(id: &str, participant_id: ParticipantId) -> SignerService {
        let storage = Storage::open_memory().expect("Failed to create test storage");
        SignerService::new(storage, id.to_string(), participant_id)
    }

    #[test]
    fn test_signer_creation() {
        let signer = create_test_signer("signer-1", 1);
        assert_eq!(signer.participant_id(), 1);
        assert!(!signer.hpke_pubkey_base64().is_empty());
    }

    #[test]
    fn test_dkg_round1() {
        let signer = create_test_signer("signer-1", 1);
        let session_id = uuid::Uuid::new_v4();

        let result = signer.dkg_round1(&session_id, 2, 3);
        assert!(result.is_ok());

        let response = result.unwrap();
        assert!(!response.package.is_empty());
        assert!(!response.hpke_pubkey.is_empty());
    }

    // Full DKG flow test would require multiple signers - will be tested in integration tests
}

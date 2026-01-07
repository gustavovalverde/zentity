//! FROST protocol types and session state management.
//!
//! This module defines serializable types for DKG and signing sessions,
//! wrapping frost-secp256k1 types with JSON-serializable representations.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::Ciphersuite;

// Re-export FROST types for convenience
pub use frost_secp256k1::Identifier;

/// Session ID type alias for clarity.
pub type SessionId = Uuid;

/// Participant identifier (1-based index in FROST).
pub type ParticipantId = u16;

// =============================================================================
// DKG Types
// =============================================================================

/// DKG session state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DkgState {
    /// Waiting for round 1 packages from all participants.
    AwaitingRound1,
    /// Waiting for round 2 packages from all participants.
    AwaitingRound2,
    /// DKG completed successfully.
    Completed,
    /// DKG failed.
    Failed,
}

impl std::fmt::Display for DkgState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AwaitingRound1 => write!(f, "awaiting_round1"),
            Self::AwaitingRound2 => write!(f, "awaiting_round2"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

/// DKG session tracked by the coordinator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgSession {
    /// Unique session identifier.
    pub session_id: SessionId,
    /// Current state.
    pub state: DkgState,
    /// Threshold (t in t-of-n).
    pub threshold: u16,
    /// Total participants (n in t-of-n).
    pub total_participants: u16,
    /// Ciphersuite for this session.
    pub ciphersuite: Ciphersuite,
    /// Participant IDs (1-based).
    pub participant_ids: Vec<ParticipantId>,
    /// Mapping of participant ID to signer endpoint URL.
    pub participant_endpoints: HashMap<ParticipantId, String>,
    /// HPKE public keys for each participant (base64 encoded).
    /// Used to encrypt round-2 shares.
    pub participant_hpke_pubkeys: HashMap<ParticipantId, String>,
    /// Round 1 packages received (participant ID -> base64 package).
    pub round1_packages: HashMap<ParticipantId, String>,
    /// Round 2 packages received (from_id -> to_id -> base64 encrypted package).
    pub round2_packages: HashMap<ParticipantId, HashMap<ParticipantId, String>>,
    /// Group public key (set after successful DKG).
    pub group_pubkey: Option<String>,
    /// Verifying shares for each participant (set after successful DKG).
    pub verifying_shares: HashMap<ParticipantId, String>,
    /// Session creation time.
    pub created_at: DateTime<Utc>,
    /// Session expiry time.
    pub expires_at: DateTime<Utc>,
    /// Error message if failed.
    pub error: Option<String>,
}

impl DkgSession {
    /// Create a new DKG session.
    pub fn new(
        threshold: u16,
        total_participants: u16,
        ciphersuite: Ciphersuite,
        participant_endpoints: HashMap<ParticipantId, String>,
        participant_hpke_pubkeys: HashMap<ParticipantId, String>,
        expiry_hours: i64,
    ) -> Self {
        let now = Utc::now();
        let participant_ids: Vec<ParticipantId> = participant_endpoints.keys().copied().collect();

        Self {
            session_id: Uuid::new_v4(),
            state: DkgState::AwaitingRound1,
            threshold,
            total_participants,
            ciphersuite,
            participant_ids,
            participant_endpoints,
            participant_hpke_pubkeys,
            round1_packages: HashMap::new(),
            round2_packages: HashMap::new(),
            group_pubkey: None,
            verifying_shares: HashMap::new(),
            created_at: now,
            expires_at: now + chrono::Duration::hours(expiry_hours),
            error: None,
        }
    }

    /// Check if all round 1 packages have been received.
    pub fn round1_complete(&self) -> bool {
        self.participant_ids
            .iter()
            .all(|id| self.round1_packages.contains_key(id))
    }

    /// Check if all round 2 packages have been received.
    pub fn round2_complete(&self) -> bool {
        // Each participant sends to all other participants
        for from_id in &self.participant_ids {
            let packages = self.round2_packages.get(from_id);
            for to_id in &self.participant_ids {
                if from_id != to_id {
                    let has_package = packages.is_some_and(|p| p.contains_key(to_id));
                    if !has_package {
                        return false;
                    }
                }
            }
        }
        true
    }

    /// Check if session has expired.
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Transition to failed state with error message.
    pub fn fail(&mut self, error: String) {
        self.state = DkgState::Failed;
        self.error = Some(error);
    }
}

// =============================================================================
// Signing Types
// =============================================================================

/// Signing session state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningState {
    /// Waiting for commitments from selected signers.
    AwaitingCommitments,
    /// Waiting for partial signatures from committed signers.
    AwaitingPartials,
    /// Signing completed successfully.
    Completed,
    /// Signing failed.
    Failed,
}

impl std::fmt::Display for SigningState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AwaitingCommitments => write!(f, "awaiting_commitments"),
            Self::AwaitingPartials => write!(f, "awaiting_partials"),
            Self::Completed => write!(f, "completed"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

/// Signing session tracked by the coordinator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningSession {
    /// Unique session identifier.
    pub session_id: SessionId,
    /// Current state.
    pub state: SigningState,
    /// Group public key (from DKG).
    pub group_pubkey: String,
    /// Ciphersuite for this session.
    pub ciphersuite: Ciphersuite,
    /// Message to sign (base64 encoded).
    pub message: String,
    /// Selected signer participant IDs (must have at least threshold).
    pub selected_signers: Vec<ParticipantId>,
    /// Mapping of participant ID to signer endpoint URL.
    pub signer_endpoints: HashMap<ParticipantId, String>,
    /// Signing commitments received (participant ID -> base64 commitment).
    pub commitments: HashMap<ParticipantId, String>,
    /// Partial signatures received (participant ID -> base64 signature share).
    pub partial_signatures: HashMap<ParticipantId, String>,
    /// Final aggregated signature (set after successful signing).
    pub signature: Option<String>,
    /// Session creation time.
    pub created_at: DateTime<Utc>,
    /// Session expiry time.
    pub expires_at: DateTime<Utc>,
    /// Error message if failed.
    pub error: Option<String>,
}

impl SigningSession {
    /// Create a new signing session.
    pub fn new(
        group_pubkey: String,
        ciphersuite: Ciphersuite,
        message: String,
        selected_signers: Vec<ParticipantId>,
        signer_endpoints: HashMap<ParticipantId, String>,
        expiry_minutes: i64,
    ) -> Self {
        let now = Utc::now();

        Self {
            session_id: Uuid::new_v4(),
            state: SigningState::AwaitingCommitments,
            group_pubkey,
            ciphersuite,
            message,
            selected_signers,
            signer_endpoints,
            commitments: HashMap::new(),
            partial_signatures: HashMap::new(),
            signature: None,
            created_at: now,
            expires_at: now + chrono::Duration::minutes(expiry_minutes),
            error: None,
        }
    }

    /// Check if all commitments have been received.
    pub fn commitments_complete(&self) -> bool {
        self.selected_signers
            .iter()
            .all(|id| self.commitments.contains_key(id))
    }

    /// Check if all partial signatures have been received.
    pub fn partials_complete(&self) -> bool {
        self.selected_signers
            .iter()
            .all(|id| self.partial_signatures.contains_key(id))
    }

    /// Check if session has expired.
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Transition to failed state with error message.
    pub fn fail(&mut self, error: String) {
        self.state = SigningState::Failed;
        self.error = Some(error);
    }
}

// =============================================================================
// Key Share Types (Signer storage)
// =============================================================================

/// Encrypted key share stored by a signer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredKeyShare {
    /// Unique identifier for this key share.
    pub share_id: String,
    /// Participant ID within the group.
    pub participant_id: ParticipantId,
    /// Group public key this share belongs to.
    pub group_pubkey: String,
    /// Ciphersuite used.
    pub ciphersuite: Ciphersuite,
    /// Encrypted key package (AES-256-GCM with envelope encryption).
    pub encrypted_key_package: String,
    /// Encryption nonce (base64).
    pub nonce: String,
    /// Data Encryption Key encrypted with KEK (base64).
    pub encrypted_dek: String,
    /// Verifying share for this participant (public).
    pub verifying_share: String,
    /// When this share was created.
    pub created_at: DateTime<Utc>,
}

// =============================================================================
// API Request/Response Types
// =============================================================================

/// Request to initialize a DKG session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgInitRequest {
    /// Threshold (t in t-of-n).
    pub threshold: u16,
    /// Total participants (n in t-of-n).
    pub total_participants: u16,
    /// Ciphersuite to use.
    #[serde(default)]
    pub ciphersuite: Ciphersuite,
    /// Mapping of participant ID to signer endpoint URL.
    /// Optional - if not provided, coordinator will use SIGNER_ENDPOINTS config.
    #[serde(default)]
    pub participant_endpoints: Option<HashMap<ParticipantId, String>>,
    /// HPKE public keys for each participant (base64 encoded).
    pub participant_hpke_pubkeys: HashMap<ParticipantId, String>,
}

/// Response from DKG initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgInitResponse {
    pub session_id: SessionId,
    pub state: DkgState,
    pub participants_ready: Vec<ParticipantId>,
}

/// Request to submit a round 1 package.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgRound1Request {
    pub session_id: SessionId,
    pub participant_id: ParticipantId,
    /// Round 1 package (base64 encoded serialized package).
    pub package: String,
}

/// Response from round 1 submission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgRound1Response {
    pub session_id: SessionId,
    pub state: DkgState,
    pub participants_ready: Vec<ParticipantId>,
}

/// Request to submit a round 2 package (encrypted for recipient).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgRound2Request {
    pub session_id: SessionId,
    pub from_participant_id: ParticipantId,
    pub to_participant_id: ParticipantId,
    /// HPKE-encrypted round 2 package (base64).
    pub encrypted_package: String,
}

/// Response from round 2 submission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgRound2Response {
    pub session_id: SessionId,
    pub state: DkgState,
    pub round2_complete: bool,
}

/// Request to finalize DKG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgFinalizeRequest {
    pub session_id: SessionId,
}

/// Response from DKG finalization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DkgFinalizeResponse {
    pub session_id: SessionId,
    pub state: DkgState,
    /// Group public key (hex encoded).
    pub group_pubkey: Option<String>,
    /// Verifying shares for each participant.
    pub verifying_shares: HashMap<ParticipantId, String>,
}

/// Request to initialize a signing session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningInitRequest {
    /// Group public key identifying the key set.
    pub group_pubkey: String,
    /// Message to sign (base64 encoded).
    pub message: String,
    /// Optional: specific signers to use. If not provided, uses all available.
    pub selected_signers: Option<Vec<ParticipantId>>,
}

/// Response from signing initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningInitResponse {
    pub session_id: SessionId,
    pub state: SigningState,
    pub selected_signers: Vec<ParticipantId>,
}

/// Request for a signer to submit commitment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningCommitRequest {
    pub session_id: SessionId,
    pub participant_id: ParticipantId,
    /// Signing commitment (base64 encoded).
    pub commitment: String,
}

/// Response from commitment submission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningCommitResponse {
    pub session_id: SessionId,
    pub state: SigningState,
    pub commitments_received: Vec<ParticipantId>,
}

/// Request for a signer to produce partial signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningPartialRequest {
    pub session_id: SessionId,
    pub participant_id: ParticipantId,
    /// All commitments from the signing session (participant_id -> base64 commitment).
    pub all_commitments: HashMap<ParticipantId, String>,
    /// Message to sign (base64 encoded).
    pub message: String,
}

/// Response from partial signature generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningPartialResponse {
    pub session_id: SessionId,
    /// Partial signature (base64 encoded).
    pub partial_signature: String,
}

/// Request to aggregate partial signatures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningAggregateRequest {
    pub session_id: SessionId,
}

/// Response from signature aggregation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningAggregateResponse {
    pub session_id: SessionId,
    pub state: SigningState,
    /// Final aggregated signature (hex encoded).
    pub signature: Option<String>,
    /// Group public key (for verification).
    pub group_pubkey: String,
}

/// Request to submit a partial signature to the coordinator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningSubmitPartialRequest {
    pub session_id: SessionId,
    pub participant_id: ParticipantId,
    /// Partial signature (base64 encoded).
    pub partial_signature: String,
}

/// Response from partial signature submission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningSubmitPartialResponse {
    pub session_id: SessionId,
    pub state: SigningState,
    /// Number of partial signatures collected.
    pub partials_collected: usize,
    /// Whether all partials have been collected.
    pub partials_complete: bool,
}

// =============================================================================
// Signer-specific API Types (internal endpoints)
// =============================================================================

/// Request for signer to participate in DKG round 1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerDkgRound1Request {
    pub session_id: SessionId,
    pub participant_id: ParticipantId,
    pub threshold: u16,
    pub total_participants: u16,
}

/// Response from signer DKG round 1.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerDkgRound1Response {
    /// Round 1 package (base64 encoded).
    pub package: String,
    /// Signer's HPKE public key for receiving encrypted round 2 shares.
    pub hpke_pubkey: String,
}

/// Request for signer to process DKG round 2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerDkgRound2Request {
    pub session_id: SessionId,
    pub participant_id: ParticipantId,
    /// All round 1 packages (participant_id -> base64 package).
    pub round1_packages: HashMap<ParticipantId, String>,
    /// All participant HPKE public keys (participant_id -> base64 pubkey).
    pub participant_hpke_pubkeys: HashMap<ParticipantId, String>,
}

/// Response from signer DKG round 2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerDkgRound2Response {
    /// Round 2 packages to send to each participant (to_id -> base64 encrypted package).
    pub packages: HashMap<ParticipantId, String>,
}

/// Request for signer to finalize DKG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerDkgFinalizeRequest {
    pub session_id: SessionId,
    pub participant_id: ParticipantId,
    /// All round 2 packages received by this signer (from_id -> base64 encrypted package).
    pub round2_packages: HashMap<ParticipantId, String>,
    /// All round 1 packages for verification.
    pub round1_packages: HashMap<ParticipantId, String>,
}

/// Response from signer DKG finalization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerDkgFinalizeResponse {
    /// Group public key (hex encoded).
    pub group_pubkey: String,
    /// This signer's verifying share (hex encoded).
    pub verifying_share: String,
}

/// Request for signer to generate signing commitment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerCommitRequest {
    pub session_id: SessionId,
    pub group_pubkey: String,
    /// Guardian assertion JWT (required when JWT verification is enabled).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guardian_assertion: Option<String>,
}

/// Response from signer commitment generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerCommitResponse {
    /// Signing commitment (base64 encoded).
    pub commitment: String,
}

/// Request for signer to generate partial signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerPartialSignRequest {
    pub session_id: SessionId,
    pub group_pubkey: String,
    /// Message to sign (base64 encoded).
    pub message: String,
    /// All commitments from participants (participant_id -> base64 commitment).
    pub all_commitments: HashMap<ParticipantId, String>,
    /// Guardian assertion JWT (required when JWT verification is enabled).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guardian_assertion: Option<String>,
}

/// Response from signer partial signature generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerPartialSignResponse {
    /// Partial signature (base64 encoded).
    pub partial_signature: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dkg_session_creation() {
        let mut endpoints = HashMap::new();
        endpoints.insert(1, "http://signer-1:5101".to_string());
        endpoints.insert(2, "http://signer-2:5102".to_string());
        endpoints.insert(3, "http://signer-3:5103".to_string());

        let hpke_keys = HashMap::new();

        let session = DkgSession::new(2, 3, Ciphersuite::Secp256k1, endpoints, hpke_keys, 24);

        assert_eq!(session.state, DkgState::AwaitingRound1);
        assert_eq!(session.threshold, 2);
        assert_eq!(session.total_participants, 3);
        assert!(!session.round1_complete());
        assert!(!session.is_expired());
    }

    #[test]
    fn test_signing_session_creation() {
        let mut endpoints = HashMap::new();
        endpoints.insert(1, "http://signer-1:5101".to_string());
        endpoints.insert(2, "http://signer-2:5102".to_string());

        let session = SigningSession::new(
            "deadbeef".to_string(),
            Ciphersuite::Secp256k1,
            "bWVzc2FnZQ==".to_string(),
            vec![1, 2],
            endpoints,
            10,
        );

        assert_eq!(session.state, SigningState::AwaitingCommitments);
        assert!(!session.commitments_complete());
        assert!(!session.is_expired());
    }

    #[test]
    fn test_dkg_state_display() {
        assert_eq!(format!("{}", DkgState::AwaitingRound1), "awaiting_round1");
        assert_eq!(format!("{}", DkgState::Completed), "completed");
    }

    #[test]
    fn test_signing_state_display() {
        assert_eq!(
            format!("{}", SigningState::AwaitingCommitments),
            "awaiting_commitments"
        );
        assert_eq!(format!("{}", SigningState::Completed), "completed");
    }
}

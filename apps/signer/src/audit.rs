//! Hash-chained audit log for FROST operations.
//!
//! Provides tamper-evident audit logging with:
//! - Sequential entries linked by SHA-256 hashes
//! - Ed25519 signatures on each entry
//! - Chain verification for integrity checking
//!
//! ## Security Properties
//!
//! - **Tamper-evident**: Modifying any entry breaks the hash chain
//! - **Non-repudiation**: Ed25519 signatures prove entry authenticity
//! - **Ordered**: Sequence numbers prevent reordering attacks

use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};

use chrono::{DateTime, Utc};
use ed25519_dalek::{SecretKey, Signer, SigningKey, Verifier, VerifyingKey};
use hpke::rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{SignerError, SignerResult};
use crate::frost::types::{ParticipantId, SessionId};
use crate::storage::Storage;

/// Types of auditable events.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    // DKG events
    DkgInit,
    DkgRound1,
    DkgRound2,
    DkgFinalize,
    // Signing events
    SigningInit,
    SigningCommit,
    SigningPartial,
    SigningAggregate,
    // System events
    ServiceStart,
    ServiceStop,
    ConfigChange,
}

impl std::fmt::Display for AuditEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DkgInit => write!(f, "dkg_init"),
            Self::DkgRound1 => write!(f, "dkg_round1"),
            Self::DkgRound2 => write!(f, "dkg_round2"),
            Self::DkgFinalize => write!(f, "dkg_finalize"),
            Self::SigningInit => write!(f, "signing_init"),
            Self::SigningCommit => write!(f, "signing_commit"),
            Self::SigningPartial => write!(f, "signing_partial"),
            Self::SigningAggregate => write!(f, "signing_aggregate"),
            Self::ServiceStart => write!(f, "service_start"),
            Self::ServiceStop => write!(f, "service_stop"),
            Self::ConfigChange => write!(f, "config_change"),
        }
    }
}

/// Actor that triggered an audit event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuditActor {
    /// Coordinator service action.
    Coordinator { service_id: String },
    /// Participant (signer) action.
    Participant { participant_id: ParticipantId },
    /// Guardian action (with JWT).
    Guardian { guardian_id: String },
    /// System action (startup, config).
    System,
}

/// Outcome of an audited operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AuditOutcome {
    /// Operation succeeded.
    Success,
    /// Operation failed.
    Failure { reason: String },
    /// Operation is pending/in-progress.
    Pending,
}

/// A single audit log entry with hash-chain linking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// Sequence number (monotonically increasing).
    pub seq: u64,
    /// Timestamp when the entry was created.
    pub timestamp: DateTime<Utc>,
    /// Type of event.
    pub event_type: AuditEventType,
    /// Actor that triggered the event.
    pub actor: AuditActor,
    /// Related session ID (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<SessionId>,
    /// Outcome of the operation.
    pub outcome: AuditOutcome,
    /// Additional context (JSON-serializable data).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
    /// SHA-256 hash of the previous entry (hex).
    pub prev_hash: String,
    /// Ed25519 signature of this entry (hex).
    pub signature: String,
}

impl AsRef<Self> for AuditEntry {
    fn as_ref(&self) -> &Self {
        self
    }
}

impl AuditEntry {
    /// Compute the canonical bytes for hashing/signing.
    fn canonical_bytes(&self) -> Vec<u8> {
        // Canonical format: seq|timestamp|event_type|actor|session_id|outcome|context|prev_hash
        // Excludes signature field
        let mut data = Vec::new();
        data.extend_from_slice(&self.seq.to_be_bytes());
        data.extend_from_slice(self.timestamp.to_rfc3339().as_bytes());
        data.extend_from_slice(self.event_type.to_string().as_bytes());
        data.extend_from_slice(
            serde_json::to_string(&self.actor)
                .unwrap_or_default()
                .as_bytes(),
        );
        if let Some(ref session_id) = self.session_id {
            data.extend_from_slice(session_id.to_string().as_bytes());
        }
        data.extend_from_slice(
            serde_json::to_string(&self.outcome)
                .unwrap_or_default()
                .as_bytes(),
        );
        if let Some(ref context) = self.context {
            data.extend_from_slice(context.to_string().as_bytes());
        }
        data.extend_from_slice(self.prev_hash.as_bytes());
        data
    }

    /// Compute SHA-256 hash of this entry.
    pub fn hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.canonical_bytes());
        hasher.update(self.signature.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Verify the signature on this entry.
    pub fn verify_signature(&self, verifying_key: &VerifyingKey) -> bool {
        let Ok(signature_bytes) = hex::decode(&self.signature) else {
            return false;
        };

        let Ok(signature) = ed25519_dalek::Signature::from_slice(&signature_bytes) else {
            return false;
        };

        let data = self.canonical_bytes();
        verifying_key.verify(&data, &signature).is_ok()
    }
}

/// Genesis hash for the first entry in the chain.
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Audit logger with hash-chaining and signing.
pub struct AuditLogger {
    storage: Storage,
    signing_key: SigningKey,
    /// Current sequence number (atomic for thread safety).
    current_seq: AtomicU64,
    /// Serialize appends to preserve hash chain integrity.
    append_lock: Mutex<()>,
}

impl AuditLogger {
    /// Create a new audit logger.
    ///
    /// Generates a new Ed25519 signing key. For production, the key should be
    /// loaded from secure storage or HSM.
    pub fn new(storage: Storage) -> SignerResult<Self> {
        // Generate a new signing key (in production, load from secure storage)
        let mut secret_key_bytes: SecretKey = [0u8; 32];
        OsRng.fill_bytes(&mut secret_key_bytes);
        let signing_key = SigningKey::from_bytes(&secret_key_bytes);

        // Get the latest sequence number from storage
        let current_seq = storage.get_latest_audit_seq()?.unwrap_or(0);

        Ok(Self {
            storage,
            signing_key,
            current_seq: AtomicU64::new(current_seq),
            append_lock: Mutex::new(()),
        })
    }

    /// Create an audit logger with a specific signing key.
    pub fn with_signing_key(storage: Storage, signing_key: SigningKey) -> SignerResult<Self> {
        let current_seq = storage.get_latest_audit_seq()?.unwrap_or(0);

        Ok(Self {
            storage,
            signing_key,
            current_seq: AtomicU64::new(current_seq),
            append_lock: Mutex::new(()),
        })
    }

    /// Get the verifying key for signature verification.
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    /// Get the verifying key as hex.
    pub fn verifying_key_hex(&self) -> String {
        hex::encode(self.verifying_key().as_bytes())
    }

    /// Append a new audit entry.
    ///
    /// Returns the sequence number of the new entry.
    pub fn append(
        &self,
        event_type: AuditEventType,
        actor: AuditActor,
        session_id: Option<SessionId>,
        outcome: AuditOutcome,
        context: Option<serde_json::Value>,
    ) -> SignerResult<u64> {
        let _append_guard = self
            .append_lock
            .lock()
            .map_err(|_e| SignerError::Storage("Audit append lock poisoned".to_string()))?;

        // Get next sequence number
        let seq = self.current_seq.load(Ordering::SeqCst) + 1;

        // Get previous hash
        let prev_hash = if seq == 1 {
            GENESIS_HASH.to_string()
        } else {
            self.storage
                .get_audit_entry(seq - 1)?
                .map(|entry| entry.hash())
                .ok_or_else(|| SignerError::Storage(format!("Missing audit entry {}", seq - 1)))?
        };

        // Create entry (without signature)
        let mut entry = AuditEntry {
            seq,
            timestamp: Utc::now(),
            event_type,
            actor,
            session_id,
            outcome,
            context,
            prev_hash,
            signature: String::new(),
        };

        // Sign the entry
        let data = entry.canonical_bytes();
        let signature = self.signing_key.sign(&data);
        entry.signature = hex::encode(signature.to_bytes());

        // Store entry
        self.storage.put_audit_entry(&entry)?;
        self.current_seq.store(seq, Ordering::SeqCst);

        tracing::debug!(
            seq = seq,
            event_type = %event_type,
            "Audit entry appended"
        );

        Ok(seq)
    }

    /// Verify the hash chain integrity between two sequence numbers.
    ///
    /// Returns `Ok(true)` if the chain is valid, `Ok(false)` if invalid,
    /// or an error if entries cannot be loaded.
    pub fn verify_chain(&self, start: u64, end: u64) -> SignerResult<bool> {
        if start > end {
            return Ok(false);
        }

        let verifying_key = self.verifying_key();
        let mut expected_prev_hash = if start == 1 {
            GENESIS_HASH.to_string()
        } else {
            self.storage
                .get_audit_entry(start - 1)?
                .map(|e| e.hash())
                .ok_or_else(|| SignerError::Storage(format!("Missing audit entry {}", start - 1)))?
        };

        for seq in start..=end {
            let entry = self
                .storage
                .get_audit_entry(seq)?
                .ok_or_else(|| SignerError::Storage(format!("Missing audit entry {seq}")))?;

            // Verify hash chain
            if entry.prev_hash != expected_prev_hash {
                tracing::warn!(
                    seq = seq,
                    expected = %expected_prev_hash,
                    actual = %entry.prev_hash,
                    "Hash chain broken"
                );
                return Ok(false);
            }

            // Verify signature
            if !entry.verify_signature(&verifying_key) {
                tracing::warn!(seq = seq, "Invalid signature on audit entry");
                return Ok(false);
            }

            expected_prev_hash = entry.hash();
        }

        Ok(true)
    }

    /// Get the current sequence number.
    pub fn current_seq(&self) -> u64 {
        self.current_seq.load(Ordering::SeqCst)
    }

    /// Get an audit entry by sequence number.
    pub fn get_entry(&self, seq: u64) -> SignerResult<Option<AuditEntry>> {
        self.storage.get_audit_entry(seq)
    }

    /// List audit entries in a range.
    pub fn list_entries(&self, start: u64, end: u64) -> SignerResult<Vec<AuditEntry>> {
        let mut entries = Vec::new();
        for seq in start..=end {
            if let Some(entry) = self.storage.get_audit_entry(seq)? {
                entries.push(entry);
            }
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_logger() -> AuditLogger {
        let storage = Storage::open_memory().expect("Failed to create test storage");
        AuditLogger::new(storage).expect("Failed to create audit logger")
    }

    #[test]
    fn test_append_and_retrieve() {
        let logger = create_test_logger();

        let seq = logger
            .append(
                AuditEventType::DkgInit,
                AuditActor::Coordinator {
                    service_id: "coordinator-1".to_string(),
                },
                Some(uuid::Uuid::new_v4()),
                AuditOutcome::Success,
                None,
            )
            .unwrap();

        assert_eq!(seq, 1);

        let entry = logger.get_entry(1).unwrap().unwrap();
        assert_eq!(entry.seq, 1);
        assert_eq!(entry.event_type, AuditEventType::DkgInit);
        assert_eq!(entry.prev_hash, GENESIS_HASH);
    }

    #[test]
    fn test_hash_chain() {
        let logger = create_test_logger();

        // Append 3 entries
        for i in 1_u16..=3 {
            logger
                .append(
                    AuditEventType::DkgRound1,
                    AuditActor::Participant {
                        participant_id: ParticipantId::new_unwrap(i),
                    },
                    Some(uuid::Uuid::new_v4()),
                    AuditOutcome::Success,
                    None,
                )
                .unwrap();
        }

        // Verify chain
        assert!(logger.verify_chain(1, 3).unwrap());

        // Verify each entry links to the previous
        let entry1 = logger.get_entry(1).unwrap().unwrap();
        let entry2 = logger.get_entry(2).unwrap().unwrap();
        let entry3 = logger.get_entry(3).unwrap().unwrap();

        assert_eq!(entry1.prev_hash, GENESIS_HASH);
        assert_eq!(entry2.prev_hash, entry1.hash());
        assert_eq!(entry3.prev_hash, entry2.hash());
    }

    #[test]
    fn test_signature_verification() {
        let logger = create_test_logger();

        logger
            .append(
                AuditEventType::ServiceStart,
                AuditActor::System,
                None,
                AuditOutcome::Success,
                None,
            )
            .unwrap();

        let entry = logger.get_entry(1).unwrap().unwrap();
        assert!(entry.verify_signature(&logger.verifying_key()));
    }

    #[test]
    fn test_event_type_display() {
        assert_eq!(AuditEventType::DkgInit.to_string(), "dkg_init");
        assert_eq!(
            AuditEventType::SigningAggregate.to_string(),
            "signing_aggregate"
        );
    }
}

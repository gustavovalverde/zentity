//! Coordinator logic for DKG and signing orchestration.
//!
//! The coordinator never sees plaintext key shares. It orchestrates:
//! - DKG: Collects round1/round2 packages from signers, finalizes sessions
//! - Signing: Collects commitments and partial signatures, aggregates final signature
//!
//! All cryptographic operations happen on the signers.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use frost_ed25519 as frost_ed;
use frost_secp256k1 as frost_secp;
use reqwest::Client;

use crate::audit::{AuditActor, AuditEventType, AuditLogger, AuditOutcome};
use crate::config::Settings;
use crate::error::{SignerError, SignerResult};
use crate::frost::key_format::secp256k1_x_parity_from_group_pubkey_hex;
use crate::frost::types::{
    DkgFinalizeRequest, DkgFinalizeResponse, DkgInitRequest, DkgInitResponse, DkgRound1Request,
    DkgRound1Response, DkgRound2Request, DkgRound2Response, DkgSession, DkgState, GroupKeyRecord,
    ParticipantId, SessionId, SignerCommitRequest, SignerCommitResponse, SignerDkgFinalizeRequest,
    SignerDkgFinalizeResponse, SignerDkgRound1Request, SignerDkgRound1Response,
    SignerDkgRound2Request, SignerDkgRound2Response, SignerPartialSignRequest,
    SignerPartialSignResponse, SigningAggregateRequest, SigningAggregateResponse,
    SigningCommitRequest, SigningCommitResponse, SigningInitRequest, SigningInitResponse,
    SigningSession, SigningState, SigningSubmitPartialRequest, SigningSubmitPartialResponse,
};
use crate::storage::Storage;
use crate::tls;

/// Default DKG session expiry in hours.
const DKG_EXPIRY_HOURS: i64 = 24;

/// Default signing session expiry in minutes.
const SIGNING_EXPIRY_MINUTES: i64 = 10;

/// HTTP client timeout for signer requests.
const SIGNER_REQUEST_TIMEOUT_SECS: u64 = 30;

/// Coordinator service for orchestrating DKG and signing.
pub struct Coordinator {
    storage: Storage,
    http_client: Client,
    signer_endpoints: Vec<String>,
    audit_logger: Option<Arc<AuditLogger>>,
    service_id: String,
}

// Allow unused_async: these handlers are async for Actix-web compatibility and will
// make HTTP calls to signers when orchestration is implemented. Currently they only
// do synchronous storage operations but the async signature is intentional.
#[allow(clippy::unused_async)]
impl Coordinator {
    /// Create a new coordinator.
    ///
    /// If mTLS is enabled in settings, configures the HTTP client with client
    /// certificate authentication for secure communication with signers.
    pub fn new(storage: Storage, settings: &Settings) -> SignerResult<Self> {
        let http_client = if settings.mtls_enabled() {
            let ca_path = settings
                .mtls_ca_path()
                .ok_or_else(|| SignerError::TlsConfig("mTLS CA path required".to_string()))?;
            let cert_path = settings
                .mtls_cert_path()
                .ok_or_else(|| SignerError::TlsConfig("mTLS cert path required".to_string()))?;
            let key_path = settings
                .mtls_key_path()
                .ok_or_else(|| SignerError::TlsConfig("mTLS key path required".to_string()))?;

            // Check key file permissions
            tls::check_key_permissions(key_path);

            let tls_config = tls::load_client_config(ca_path, cert_path, key_path)?;

            tracing::info!("Creating coordinator HTTP client with mTLS");
            Client::builder()
                .timeout(std::time::Duration::from_secs(SIGNER_REQUEST_TIMEOUT_SECS))
                .use_preconfigured_tls(tls_config)
                .build()
                .map_err(|e| SignerError::TlsConfig(format!("Failed to create mTLS client: {e}")))?
        } else {
            tracing::warn!(
                "Creating coordinator HTTP client WITHOUT mTLS - development mode only! \
                 Set SIGNER_MTLS_CA_PATH, SIGNER_MTLS_CERT_PATH, SIGNER_MTLS_KEY_PATH for production."
            );
            Client::builder()
                .timeout(std::time::Duration::from_secs(SIGNER_REQUEST_TIMEOUT_SECS))
                .build()
                .map_err(|e| SignerError::TlsConfig(format!("Failed to create HTTP client: {e}")))?
        };

        Ok(Self {
            storage,
            http_client,
            signer_endpoints: settings.signer_endpoints().to_vec(),
            audit_logger: None,
            service_id: "coordinator".to_string(),
        })
    }

    /// Create a new coordinator with audit logging enabled.
    pub fn with_audit_logger(
        storage: Storage,
        settings: &Settings,
        audit_logger: Arc<AuditLogger>,
        service_id: String,
    ) -> SignerResult<Self> {
        let mut coordinator = Self::new(storage, settings)?;
        coordinator.audit_logger = Some(audit_logger);
        coordinator.service_id = service_id;
        Ok(coordinator)
    }

    /// Log an audit event if audit logging is enabled.
    fn audit_log(
        &self,
        event_type: AuditEventType,
        session_id: Option<SessionId>,
        outcome: AuditOutcome,
        context: Option<serde_json::Value>,
    ) {
        if let Some(ref logger) = self.audit_logger {
            let actor = AuditActor::Coordinator {
                service_id: self.service_id.clone(),
            };
            if let Err(e) = logger.append(event_type, actor, session_id, outcome, context) {
                tracing::error!(error = %e, "Failed to write audit log entry");
            }
        }
    }

    // =========================================================================
    // DKG Operations
    // =========================================================================

    /// Initialize a new DKG session.
    pub async fn init_dkg(&self, request: DkgInitRequest) -> SignerResult<DkgInitResponse> {
        // Validate threshold
        if request.threshold < 2 {
            let err = SignerError::InvalidThreshold {
                threshold: request.threshold,
                total: request.total_participants,
            };
            self.audit_log(
                AuditEventType::DkgInit,
                None,
                AuditOutcome::Failure {
                    reason: err.to_string(),
                },
                None,
            );
            return Err(err);
        }
        if request.threshold > request.total_participants {
            let err = SignerError::InvalidThreshold {
                threshold: request.threshold,
                total: request.total_participants,
            };
            self.audit_log(
                AuditEventType::DkgInit,
                None,
                AuditOutcome::Failure {
                    reason: err.to_string(),
                },
                None,
            );
            return Err(err);
        }

        // Derive participant endpoints: use request if provided, otherwise use SIGNER_ENDPOINTS config
        let participant_endpoints = if let Some(endpoints) = request.participant_endpoints {
            // Validate provided endpoints
            if endpoints.len() != request.total_participants as usize {
                return Err(SignerError::InvalidInput(format!(
                    "Expected {} participant endpoints, got {}",
                    request.total_participants,
                    endpoints.len()
                )));
            }
            endpoints
        } else {
            // Derive from SIGNER_ENDPOINTS config (like signing flow)
            if self.signer_endpoints.len() < request.total_participants as usize {
                return Err(SignerError::InvalidInput(format!(
                    "Not enough signer endpoints configured. Need {} but have {}. \
                     Either provide participant_endpoints in request or configure SIGNER_ENDPOINTS.",
                    request.total_participants,
                    self.signer_endpoints.len()
                )));
            }
            let mut endpoints = HashMap::new();
            for (i, endpoint) in self.signer_endpoints.iter().enumerate() {
                // Safety: participant count is validated < u16::MAX
                #[allow(clippy::cast_possible_truncation)]
                let participant_id = (i + 1) as u16;
                if participant_id <= request.total_participants {
                    endpoints.insert(participant_id, endpoint.clone());
                }
            }
            endpoints
        };

        // Create session
        let session = DkgSession::new(
            request.threshold,
            request.total_participants,
            request.ciphersuite,
            participant_endpoints,
            request.participant_hpke_pubkeys,
            DKG_EXPIRY_HOURS,
        );

        let session_id = session.session_id;
        let state = session.state;

        // Store session
        self.storage
            .put_dkg_session(&session_id.to_string(), &session)?;

        tracing::info!(
            session_id = %session_id,
            threshold = request.threshold,
            total = request.total_participants,
            "DKG session initialized"
        );

        // Audit log the successful initialization
        self.audit_log(
            AuditEventType::DkgInit,
            Some(session_id),
            AuditOutcome::Success,
            Some(serde_json::json!({
                "threshold": request.threshold,
                "total_participants": request.total_participants,
                "ciphersuite": format!("{:?}", request.ciphersuite),
            })),
        );

        Ok(DkgInitResponse {
            session_id,
            state,
            participants_ready: vec![],
        })
    }

    /// Submit a DKG round 1 package.
    pub async fn submit_round1(
        &self,
        request: DkgRound1Request,
    ) -> SignerResult<DkgRound1Response> {
        let session_key = request.session_id.to_string();

        // Load session
        let mut session: DkgSession = self
            .storage
            .get_dkg_session(&session_key)?
            .ok_or_else(|| SignerError::SessionNotFound(session_key.clone()))?;

        // Validate state
        if session.state != DkgState::AwaitingRound1 {
            return Err(SignerError::InvalidSessionState {
                expected: DkgState::AwaitingRound1.to_string(),
                actual: session.state.to_string(),
            });
        }

        if session.is_expired() {
            return Err(SignerError::SessionExpired(session_key));
        }

        // Validate participant
        if !session.participant_ids.contains(&request.participant_id) {
            return Err(SignerError::InvalidParticipant(format!(
                "Participant {} not in session",
                request.participant_id
            )));
        }

        if session
            .round1_packages
            .contains_key(&request.participant_id)
        {
            return Err(SignerError::ParticipantAlreadySubmitted(format!(
                "Participant {} already submitted round 1",
                request.participant_id
            )));
        }

        // Store package
        session
            .round1_packages
            .insert(request.participant_id, request.package);

        // Check if all round 1 packages received
        if session.round1_complete() {
            session.state = DkgState::AwaitingRound2;
            tracing::info!(session_id = %request.session_id, "DKG round 1 complete, advancing to round 2");
        }

        let participants_ready: Vec<ParticipantId> =
            session.round1_packages.keys().copied().collect();
        let state = session.state;

        // Save session
        self.storage.put_dkg_session(&session_key, &session)?;

        Ok(DkgRound1Response {
            session_id: request.session_id,
            state,
            participants_ready,
        })
    }

    /// Submit a DKG round 2 package (encrypted for recipient).
    pub async fn submit_round2(
        &self,
        request: DkgRound2Request,
    ) -> SignerResult<DkgRound2Response> {
        let session_key = request.session_id.to_string();

        // Load session
        let mut session: DkgSession = self
            .storage
            .get_dkg_session(&session_key)?
            .ok_or_else(|| SignerError::SessionNotFound(session_key.clone()))?;

        // Validate state
        if session.state != DkgState::AwaitingRound2 {
            return Err(SignerError::InvalidSessionState {
                expected: DkgState::AwaitingRound2.to_string(),
                actual: session.state.to_string(),
            });
        }

        if session.is_expired() {
            return Err(SignerError::SessionExpired(session_key));
        }

        // Validate participants
        if !session
            .participant_ids
            .contains(&request.from_participant_id)
        {
            return Err(SignerError::InvalidParticipant(format!(
                "Sender {} not in session",
                request.from_participant_id
            )));
        }
        if !session.participant_ids.contains(&request.to_participant_id) {
            return Err(SignerError::InvalidParticipant(format!(
                "Recipient {} not in session",
                request.to_participant_id
            )));
        }
        if request.from_participant_id == request.to_participant_id {
            return Err(SignerError::InvalidInput(
                "Cannot send round 2 package to self".to_string(),
            ));
        }

        // Store package
        session
            .round2_packages
            .entry(request.from_participant_id)
            .or_default()
            .insert(request.to_participant_id, request.encrypted_package);

        let round2_complete = session.round2_complete();

        // Save session
        self.storage.put_dkg_session(&session_key, &session)?;

        Ok(DkgRound2Response {
            session_id: request.session_id,
            state: session.state,
            round2_complete,
        })
    }

    /// Finalize DKG session.
    ///
    /// This triggers each signer to finalize their DKG and store their key share.
    /// Returns the group public key and verifying shares.
    #[allow(clippy::too_many_lines)]
    pub async fn finalize_dkg(
        &self,
        request: DkgFinalizeRequest,
    ) -> SignerResult<DkgFinalizeResponse> {
        let session_key = request.session_id.to_string();

        // Load session
        let mut session: DkgSession = self
            .storage
            .get_dkg_session(&session_key)?
            .ok_or_else(|| SignerError::SessionNotFound(session_key.clone()))?;

        // Validate state
        if session.state != DkgState::AwaitingRound2 {
            return Err(SignerError::InvalidSessionState {
                expected: DkgState::AwaitingRound2.to_string(),
                actual: session.state.to_string(),
            });
        }

        if !session.round2_complete() {
            let missing: Vec<String> = session
                .participant_ids
                .iter()
                .filter(|id| !session.round2_packages.contains_key(id))
                .map(ToString::to_string)
                .collect();
            return Err(SignerError::MissingParticipants(missing));
        }

        // Call each signer to finalize
        let mut group_pubkey: Option<String> = None;
        let mut public_key_package: Option<String> = None;
        let mut verifying_shares: HashMap<ParticipantId, String> = HashMap::new();

        for &participant_id in &session.participant_ids {
            let endpoint = session
                .participant_endpoints
                .get(&participant_id)
                .ok_or_else(|| {
                    SignerError::InvalidParticipant(format!(
                        "No endpoint for participant {participant_id}"
                    ))
                })?;

            // Collect round 2 packages for this participant (from all others)
            let mut round2_for_participant: HashMap<ParticipantId, String> = HashMap::new();
            for (&from_id, packages) in &session.round2_packages {
                if from_id != participant_id
                    && let Some(pkg) = packages.get(&participant_id)
                {
                    round2_for_participant.insert(from_id, pkg.clone());
                }
            }

            let finalize_req = SignerDkgFinalizeRequest {
                session_id: request.session_id,
                participant_id,
                ciphersuite: session.ciphersuite,
                round2_packages: round2_for_participant,
                round1_packages: session.round1_packages.clone(),
            };

            let response = self
                .http_client
                .post(format!("{endpoint}/signer/dkg/finalize"))
                .json(&finalize_req)
                .send()
                .await
                .map_err(|e| {
                    SignerError::SignerUnreachable(format!(
                        "Failed to reach signer {participant_id}: {e}"
                    ))
                })?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(SignerError::SignerError(format!(
                    "Signer {participant_id} finalize failed: {error_text}"
                )));
            }

            let finalize_resp: SignerDkgFinalizeResponse = response.json().await.map_err(|e| {
                SignerError::Deserialization(format!(
                    "Failed to parse signer {participant_id} response: {e}"
                ))
            })?;

            // Verify all signers agree on group public key and public key package
            if let Some(ref existing_pubkey) = group_pubkey {
                if existing_pubkey != &finalize_resp.group_pubkey {
                    session.fail("Signers disagree on group public key".to_string());
                    self.storage.put_dkg_session(&session_key, &session)?;
                    return Err(SignerError::DkgFailed(
                        "Signers produced different group public keys".to_string(),
                    ));
                }
            } else {
                group_pubkey = Some(finalize_resp.group_pubkey.clone());
            }

            if let Some(ref existing_package) = public_key_package {
                if existing_package != &finalize_resp.public_key_package {
                    session.fail("Signers disagree on public key package".to_string());
                    self.storage.put_dkg_session(&session_key, &session)?;
                    return Err(SignerError::DkgFailed(
                        "Signers produced different public key packages".to_string(),
                    ));
                }
            } else {
                public_key_package = Some(finalize_resp.public_key_package.clone());
            }

            verifying_shares.insert(participant_id, finalize_resp.verifying_share);
        }

        // Update session
        session.state = DkgState::Completed;
        session.group_pubkey.clone_from(&group_pubkey);
        session.public_key_package.clone_from(&public_key_package);
        session.verifying_shares.clone_from(&verifying_shares);
        self.storage.put_dkg_session(&session_key, &session)?;

        if let (Some(group_pubkey), Some(public_key_package)) = (&group_pubkey, &public_key_package)
        {
            let record = GroupKeyRecord {
                group_pubkey: group_pubkey.clone(),
                public_key_package: public_key_package.clone(),
                ciphersuite: session.ciphersuite,
                threshold: session.threshold,
                total_participants: session.total_participants,
                created_at: chrono::Utc::now(),
            };
            self.storage.put_group_key(group_pubkey, &record)?;
        }

        tracing::info!(
            session_id = %request.session_id,
            group_pubkey = ?group_pubkey,
            "DKG session completed"
        );

        // Audit log the successful DKG finalization
        self.audit_log(
            AuditEventType::DkgFinalize,
            Some(request.session_id),
            AuditOutcome::Success,
            Some(serde_json::json!({
                "group_pubkey": group_pubkey,
                "participant_count": verifying_shares.len(),
            })),
        );

        let (group_pubkey_x, group_pubkey_parity) =
            match (group_pubkey.as_deref(), session.ciphersuite) {
                (Some(pubkey_hex), crate::config::Ciphersuite::Secp256k1) => {
                    match secp256k1_x_parity_from_group_pubkey_hex(pubkey_hex) {
                        Ok((x, parity)) => (Some(x), Some(parity)),
                        Err(_) => (None, None),
                    }
                }
                _ => (None, None),
            };

        Ok(DkgFinalizeResponse {
            session_id: request.session_id,
            state: DkgState::Completed,
            group_pubkey,
            public_key_package,
            group_pubkey_x,
            group_pubkey_parity,
            verifying_shares,
        })
    }

    /// Get DKG session status.
    pub fn get_dkg_session(&self, session_id: &SessionId) -> SignerResult<Option<DkgSession>> {
        self.storage.get_dkg_session(&session_id.to_string())
    }

    // =========================================================================
    // Signing Operations
    // =========================================================================

    /// Initialize a new signing session.
    pub async fn init_signing(
        &self,
        request: SigningInitRequest,
    ) -> SignerResult<SigningInitResponse> {
        let group_key = self
            .storage
            .get_group_key::<GroupKeyRecord>(&request.group_pubkey)?
            .ok_or_else(|| SignerError::InvalidInput("Unknown group_pubkey".to_string()))?;

        // Determine which signers to use
        // For now, map participant IDs to signer endpoints based on order
        // Safety: signer_endpoints.len() is typically small (< 100)
        #[allow(clippy::cast_possible_truncation)]
        let selected_signers = request
            .selected_signers
            .unwrap_or_else(|| (1..=self.signer_endpoints.len() as u16).collect());

        let mut signer_endpoints: HashMap<ParticipantId, String> = HashMap::new();
        for (i, endpoint) in self.signer_endpoints.iter().enumerate() {
            // Safety: participant count is typically small (< 100)
            #[allow(clippy::cast_possible_truncation)]
            let participant_id = (i + 1) as u16;
            if selected_signers.contains(&participant_id) {
                signer_endpoints.insert(participant_id, endpoint.clone());
            }
        }

        if signer_endpoints.is_empty() {
            return Err(SignerError::InvalidInput(
                "No valid signers selected".to_string(),
            ));
        }

        if selected_signers.len() < group_key.threshold as usize {
            return Err(SignerError::InsufficientSignatures {
                needed: group_key.threshold as usize,
                have: selected_signers.len(),
            });
        }

        if selected_signers
            .iter()
            .any(|id| *id > group_key.total_participants)
        {
            return Err(SignerError::InvalidParticipant(
                "Selected signer out of range for group".to_string(),
            ));
        }

        // Create session
        let session = SigningSession::new(
            request.group_pubkey,
            group_key.public_key_package.clone(),
            group_key.ciphersuite,
            group_key.threshold,
            request.message,
            selected_signers.clone(),
            signer_endpoints,
            SIGNING_EXPIRY_MINUTES,
        );

        let session_id = session.session_id;
        let state = session.state;

        // Store session
        self.storage
            .put_signing_session(&session_id.to_string(), &session)?;

        tracing::info!(
            session_id = %session_id,
            signers = ?selected_signers,
            "Signing session initialized"
        );

        // Audit log the signing session initialization
        self.audit_log(
            AuditEventType::SigningInit,
            Some(session_id),
            AuditOutcome::Success,
            Some(serde_json::json!({
                "selected_signers": selected_signers,
                "group_pubkey_prefix": &session.group_pubkey[..std::cmp::min(16, session.group_pubkey.len())],
            })),
        );

        Ok(SigningInitResponse {
            session_id,
            state,
            selected_signers,
        })
    }

    /// Submit a signing commitment.
    pub async fn submit_commitment(
        &self,
        request: SigningCommitRequest,
    ) -> SignerResult<SigningCommitResponse> {
        let session_key = request.session_id.to_string();

        // Load session
        let mut session: SigningSession = self
            .storage
            .get_signing_session(&session_key)?
            .ok_or_else(|| SignerError::SessionNotFound(session_key.clone()))?;

        // Validate state
        if session.state != SigningState::AwaitingCommitments {
            return Err(SignerError::InvalidSessionState {
                expected: SigningState::AwaitingCommitments.to_string(),
                actual: session.state.to_string(),
            });
        }

        if session.is_expired() {
            return Err(SignerError::SessionExpired(session_key));
        }

        // Validate participant
        if !session.selected_signers.contains(&request.participant_id) {
            return Err(SignerError::InvalidParticipant(format!(
                "Participant {} not selected for signing",
                request.participant_id
            )));
        }

        if session.commitments.contains_key(&request.participant_id) {
            return Err(SignerError::ParticipantAlreadySubmitted(format!(
                "Participant {} already submitted commitment",
                request.participant_id
            )));
        }

        // RFC 9591 §5.1: Reject duplicate commitment values
        if session
            .commitments
            .values()
            .any(|c| c == &request.commitment)
        {
            return Err(SignerError::DuplicateCommitment);
        }

        // Store commitment
        session
            .commitments
            .insert(request.participant_id, request.commitment.clone());

        // Check if all commitments received
        if session.commitments_complete() {
            session.state = SigningState::AwaitingPartials;
            tracing::info!(
                session_id = %request.session_id,
                "All commitments received, ready for partial signatures"
            );
        }

        let commitments_received: Vec<ParticipantId> =
            session.commitments.keys().copied().collect();
        let state = session.state;

        // Save session
        self.storage.put_signing_session(&session_key, &session)?;

        Ok(SigningCommitResponse {
            session_id: request.session_id,
            state,
            commitments_received,
        })
    }

    /// Collect partial signature from a signer.
    pub async fn submit_partial(
        &self,
        request: SigningSubmitPartialRequest,
    ) -> SignerResult<SigningSubmitPartialResponse> {
        let session_key = request.session_id.to_string();

        // Load session
        let mut session: SigningSession = self
            .storage
            .get_signing_session(&session_key)?
            .ok_or_else(|| SignerError::SessionNotFound(session_key.clone()))?;

        // Validate state
        if session.state != SigningState::AwaitingPartials {
            return Err(SignerError::InvalidSessionState {
                expected: SigningState::AwaitingPartials.to_string(),
                actual: session.state.to_string(),
            });
        }

        // Validate participant is in the signing session
        if !session.selected_signers.contains(&request.participant_id) {
            return Err(SignerError::InvalidParticipant(format!(
                "Participant {} not in selected signers",
                request.participant_id
            )));
        }

        // Store partial signature
        session
            .partial_signatures
            .insert(request.participant_id, request.partial_signature);

        let partials_collected = session.partial_signatures.len();
        let partials_complete = session.partials_complete();

        // Save session
        self.storage.put_signing_session(&session_key, &session)?;

        tracing::info!(
            session_id = %request.session_id,
            participant_id = request.participant_id,
            partials_collected = partials_collected,
            partials_complete = partials_complete,
            "Partial signature collected"
        );

        Ok(SigningSubmitPartialResponse {
            session_id: request.session_id,
            state: session.state,
            partials_collected,
            partials_complete,
        })
    }

    /// Aggregate partial signatures into final signature.
    #[allow(clippy::too_many_lines)]
    pub async fn aggregate_signatures(
        &self,
        request: SigningAggregateRequest,
    ) -> SignerResult<SigningAggregateResponse> {
        let session_key = request.session_id.to_string();

        // Load session
        let mut session: SigningSession = self
            .storage
            .get_signing_session(&session_key)?
            .ok_or_else(|| SignerError::SessionNotFound(session_key.clone()))?;

        // Validate state
        if session.state != SigningState::AwaitingPartials {
            return Err(SignerError::InvalidSessionState {
                expected: SigningState::AwaitingPartials.to_string(),
                actual: session.state.to_string(),
            });
        }

        if !session.partials_complete() {
            return Err(SignerError::InsufficientSignatures {
                needed: session.selected_signers.len(),
                have: session.partial_signatures.len(),
            });
        }

        // Decode message
        let message = BASE64
            .decode(&session.message)
            .map_err(|e| SignerError::InvalidInput(format!("Invalid message base64: {e}")))?;

        let signature_hex = match session.ciphersuite {
            crate::config::Ciphersuite::Secp256k1 => {
                let public_key_package_bytes =
                    hex::decode(&session.public_key_package).map_err(|e| {
                        SignerError::InvalidInput(format!("Invalid public key package hex: {e}"))
                    })?;
                let pubkey_package: frost_secp::keys::PublicKeyPackage =
                    frost_secp::keys::PublicKeyPackage::deserialize(&public_key_package_bytes)
                        .map_err(|e| {
                            SignerError::Deserialization(format!("Invalid public key package: {e}"))
                        })?;

                let mut commitments_map: BTreeMap<
                    frost_secp::Identifier,
                    frost_secp::round1::SigningCommitments,
                > = BTreeMap::new();
                for (&participant_id, commitment_b64) in &session.commitments {
                    let commitment_bytes = BASE64.decode(commitment_b64).map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid commitment base64 for {participant_id}: {e}"
                        ))
                    })?;
                    let identifier =
                        frost_secp::Identifier::try_from(participant_id).map_err(|e| {
                            SignerError::InvalidParticipant(format!(
                                "Invalid identifier {participant_id}: {e}"
                            ))
                        })?;
                    let commitment =
                        frost_secp::round1::SigningCommitments::deserialize(&commitment_bytes)
                            .map_err(|e| {
                                SignerError::Deserialization(format!(
                                    "Invalid commitment for {participant_id}: {e}"
                                ))
                            })?;
                    commitments_map.insert(identifier, commitment);
                }

                let signing_package = frost_secp::SigningPackage::new(commitments_map, &message);

                let mut signature_shares: BTreeMap<
                    frost_secp::Identifier,
                    frost_secp::round2::SignatureShare,
                > = BTreeMap::new();
                for (&participant_id, partial_b64) in &session.partial_signatures {
                    let partial_bytes = BASE64.decode(partial_b64).map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid partial signature base64 for {participant_id}: {e}"
                        ))
                    })?;
                    let identifier =
                        frost_secp::Identifier::try_from(participant_id).map_err(|e| {
                            SignerError::InvalidParticipant(format!(
                                "Invalid identifier {participant_id}: {e}"
                            ))
                        })?;
                    let signature_share = frost_secp::round2::SignatureShare::deserialize(
                        &partial_bytes,
                    )
                    .map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid signature share for {participant_id}: {e}"
                        ))
                    })?;
                    signature_shares.insert(identifier, signature_share);
                }

                let signature =
                    frost_secp::aggregate(&signing_package, &signature_shares, &pubkey_package)
                        .map_err(|e| match &e {
                            frost_secp::Error::InvalidSignatureShare { culprit } => {
                                // FROST Identifiers serialize as big-endian scalars (32 bytes)
                                // The participant ID (u16) is in the last 2 bytes
                                let bytes = culprit.serialize();
                                let len = bytes.len();
                                let culprit_id = if len >= 2 {
                                    u16::from_be_bytes([bytes[len - 2], bytes[len - 1]])
                                } else {
                                    0
                                };
                                SignerError::InvalidSignatureShare {
                                    culprits: vec![culprit_id],
                                }
                            }
                            _ => SignerError::AggregationFailed(format!("Aggregation failed: {e}")),
                        })?;

                let verifying_key = pubkey_package.verifying_key();
                verifying_key.verify(&message, &signature).map_err(|e| {
                    SignerError::InvalidSignature(format!("Verification failed: {e}"))
                })?;

                let signature_bytes = signature.serialize().map_err(|e| {
                    SignerError::Serialization(format!("Failed to serialize signature: {e}"))
                })?;
                Ok::<String, SignerError>(hex::encode(signature_bytes))
            }
            crate::config::Ciphersuite::Ed25519 => {
                let public_key_package_bytes =
                    hex::decode(&session.public_key_package).map_err(|e| {
                        SignerError::InvalidInput(format!("Invalid public key package hex: {e}"))
                    })?;
                let pubkey_package: frost_ed::keys::PublicKeyPackage =
                    frost_ed::keys::PublicKeyPackage::deserialize(&public_key_package_bytes)
                        .map_err(|e| {
                            SignerError::Deserialization(format!("Invalid public key package: {e}"))
                        })?;

                let mut commitments_map: BTreeMap<
                    frost_ed::Identifier,
                    frost_ed::round1::SigningCommitments,
                > = BTreeMap::new();
                for (&participant_id, commitment_b64) in &session.commitments {
                    let commitment_bytes = BASE64.decode(commitment_b64).map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid commitment base64 for {participant_id}: {e}"
                        ))
                    })?;
                    let identifier =
                        frost_ed::Identifier::try_from(participant_id).map_err(|e| {
                            SignerError::InvalidParticipant(format!(
                                "Invalid identifier {participant_id}: {e}"
                            ))
                        })?;
                    let commitment =
                        frost_ed::round1::SigningCommitments::deserialize(&commitment_bytes)
                            .map_err(|e| {
                                SignerError::Deserialization(format!(
                                    "Invalid commitment for {participant_id}: {e}"
                                ))
                            })?;
                    commitments_map.insert(identifier, commitment);
                }

                let signing_package = frost_ed::SigningPackage::new(commitments_map, &message);

                let mut signature_shares: BTreeMap<
                    frost_ed::Identifier,
                    frost_ed::round2::SignatureShare,
                > = BTreeMap::new();
                for (&participant_id, partial_b64) in &session.partial_signatures {
                    let partial_bytes = BASE64.decode(partial_b64).map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid partial signature base64 for {participant_id}: {e}"
                        ))
                    })?;
                    let identifier =
                        frost_ed::Identifier::try_from(participant_id).map_err(|e| {
                            SignerError::InvalidParticipant(format!(
                                "Invalid identifier {participant_id}: {e}"
                            ))
                        })?;
                    let signature_share = frost_ed::round2::SignatureShare::deserialize(
                        &partial_bytes,
                    )
                    .map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid signature share for {participant_id}: {e}"
                        ))
                    })?;
                    signature_shares.insert(identifier, signature_share);
                }

                let signature =
                    frost_ed::aggregate(&signing_package, &signature_shares, &pubkey_package)
                        .map_err(|e| match &e {
                            frost_ed::Error::InvalidSignatureShare { culprit } => {
                                // FROST Identifiers serialize as big-endian scalars (32 bytes)
                                // The participant ID (u16) is in the last 2 bytes
                                let bytes = culprit.serialize();
                                let len = bytes.len();
                                let culprit_id = if len >= 2 {
                                    u16::from_be_bytes([bytes[len - 2], bytes[len - 1]])
                                } else {
                                    0
                                };
                                SignerError::InvalidSignatureShare {
                                    culprits: vec![culprit_id],
                                }
                            }
                            _ => SignerError::AggregationFailed(format!("Aggregation failed: {e}")),
                        })?;

                let verifying_key = pubkey_package.verifying_key();
                verifying_key.verify(&message, &signature).map_err(|e| {
                    SignerError::InvalidSignature(format!("Verification failed: {e}"))
                })?;

                let signature_bytes = signature.serialize().map_err(|e| {
                    SignerError::Serialization(format!("Failed to serialize signature: {e}"))
                })?;
                Ok::<String, SignerError>(hex::encode(signature_bytes))
            }
        }?;

        // Update session
        session.state = SigningState::Completed;
        session.signature = Some(signature_hex.clone());
        self.storage.put_signing_session(&session_key, &session)?;

        tracing::info!(
            session_id = %request.session_id,
            "Signing session completed"
        );

        // Audit log the successful signature aggregation
        self.audit_log(
            AuditEventType::SigningAggregate,
            Some(request.session_id),
            AuditOutcome::Success,
            Some(serde_json::json!({
                "signature_prefix": &signature_hex[..std::cmp::min(16, signature_hex.len())],
                "partials_count": session.partial_signatures.len(),
            })),
        );

        Ok(SigningAggregateResponse {
            session_id: request.session_id,
            state: SigningState::Completed,
            signature: Some(signature_hex),
            group_pubkey: session.group_pubkey,
        })
    }

    /// Get signing session status.
    pub fn get_signing_session(
        &self,
        session_id: &SessionId,
    ) -> SignerResult<Option<SigningSession>> {
        self.storage.get_signing_session(&session_id.to_string())
    }

    // =========================================================================
    // Signer Communication Helpers
    // =========================================================================

    /// Request a signer to generate DKG round 1 package.
    pub async fn request_signer_round1(
        &self,
        endpoint: &str,
        request: SignerDkgRound1Request,
    ) -> SignerResult<SignerDkgRound1Response> {
        let response = self
            .http_client
            .post(format!("{endpoint}/signer/dkg/round1"))
            .json(&request)
            .send()
            .await
            .map_err(|e| SignerError::SignerUnreachable(format!("Failed to reach signer: {e}")))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(SignerError::SignerError(format!(
                "Signer round1 failed: {error_text}"
            )));
        }

        response.json().await.map_err(|e| {
            SignerError::Deserialization(format!("Failed to parse signer response: {e}"))
        })
    }

    /// Request a signer to generate DKG round 2 packages.
    pub async fn request_signer_round2(
        &self,
        endpoint: &str,
        request: SignerDkgRound2Request,
    ) -> SignerResult<SignerDkgRound2Response> {
        let response = self
            .http_client
            .post(format!("{endpoint}/signer/dkg/round2"))
            .json(&request)
            .send()
            .await
            .map_err(|e| SignerError::SignerUnreachable(format!("Failed to reach signer: {e}")))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(SignerError::SignerError(format!(
                "Signer round2 failed: {error_text}"
            )));
        }

        response.json().await.map_err(|e| {
            SignerError::Deserialization(format!("Failed to parse signer response: {e}"))
        })
    }

    /// Request a signer to generate signing commitment.
    pub async fn request_signer_commitment(
        &self,
        endpoint: &str,
        request: SignerCommitRequest,
    ) -> SignerResult<SignerCommitResponse> {
        let response = self
            .http_client
            .post(format!("{endpoint}/signer/sign/commit"))
            .json(&request)
            .send()
            .await
            .map_err(|e| SignerError::SignerUnreachable(format!("Failed to reach signer: {e}")))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(SignerError::SignerError(format!(
                "Signer commitment failed: {error_text}"
            )));
        }

        response.json().await.map_err(|e| {
            SignerError::Deserialization(format!("Failed to parse signer response: {e}"))
        })
    }

    /// Request a signer to generate partial signature.
    pub async fn request_signer_partial(
        &self,
        endpoint: &str,
        request: SignerPartialSignRequest,
    ) -> SignerResult<SignerPartialSignResponse> {
        let response = self
            .http_client
            .post(format!("{endpoint}/signer/sign/partial"))
            .json(&request)
            .send()
            .await
            .map_err(|e| SignerError::SignerUnreachable(format!("Failed to reach signer: {e}")))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(SignerError::SignerError(format!(
                "Signer partial signature failed: {error_text}"
            )));
        }

        response.json().await.map_err(|e| {
            SignerError::Deserialization(format!("Failed to parse signer response: {e}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dkg_session_state_transitions() {
        let mut endpoints = HashMap::new();
        endpoints.insert(1, "http://signer-1:5101".to_string());
        endpoints.insert(2, "http://signer-2:5102".to_string());

        let session = DkgSession::new(
            2,
            2,
            crate::config::Ciphersuite::Secp256k1,
            endpoints,
            HashMap::new(),
            24,
        );

        assert_eq!(session.state, DkgState::AwaitingRound1);
        assert!(!session.round1_complete());
    }

    #[test]
    fn test_signing_session_state_transitions() {
        let mut endpoints = HashMap::new();
        endpoints.insert(1, "http://signer-1:5101".to_string());
        endpoints.insert(2, "http://signer-2:5102".to_string());

        let session = SigningSession::new(
            "deadbeef".to_string(),
            "beadfeed".to_string(),
            crate::config::Ciphersuite::Secp256k1,
            2,
            BASE64.encode("test message"),
            vec![1, 2],
            endpoints,
            10,
        );

        assert_eq!(session.state, SigningState::AwaitingCommitments);
        assert!(!session.commitments_complete());
    }
}

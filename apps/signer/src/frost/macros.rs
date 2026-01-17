//! Declarative macros for FROST ciphersuite abstraction.
//!
//! # Architecture Decision
//!
//! We use macros instead of traits because:
//! - FROST crates (frost-secp256k1, frost-ed25519) expose separate, incompatible types
//! - `frost_secp::Identifier` and `frost_ed::Identifier` share no common trait
//! - The implementation logic is identical, only type names differ
//! - Macros provide single-source-of-truth with compile-time expansion

/// Generate DKG round 1 implementation for a specific ciphersuite.
///
/// Creates a function that:
/// 1. Creates FROST identifier from participant ID
/// 2. Generates round 1 secret and package via FROST DKG part1
/// 3. Stores the secret for round 2
/// 4. Returns serialized package and HPKE public key
macro_rules! impl_dkg_round1 {
    ($fn_name:ident, $frost:ident) => {
        fn $fn_name(
            &self,
            session_id: &SessionId,
            threshold: u16,
            total_participants: u16,
        ) -> SignerResult<SignerDkgRound1Response> {
            let identifier = $frost::Identifier::try_from(self.participant_id.get())
                .map_err(|e| SignerError::InvalidParticipant(format!("Invalid identifier: {e}")))?;

            let (round1_secret, round1_package) =
                $frost::keys::dkg::part1(identifier, total_participants, threshold, OsRng)
                    .map_err(|e| SignerError::DkgFailed(format!("Round 1 generation failed: {e}")))?;

            let round1_secret_bytes = round1_secret.serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize round 1 secret: {e}"))
            })?;
            self.store_round1_secret(session_id.to_string(), round1_secret_bytes)?;

            let package_bytes = round1_package.serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize round 1 package: {e}"))
            })?;

            tracing::info!(
                signer_id = %self.signer_id,
                session_id = %session_id,
                ciphersuite = %self.ciphersuite,
                "Generated DKG round 1 package"
            );

            Ok(SignerDkgRound1Response {
                package: BASE64.encode(&package_bytes),
                hpke_pubkey: self.hpke_pubkey_base64(),
            })
        }
    };
}

/// Generate DKG round 2 implementation for a specific ciphersuite.
///
/// Creates a function that:
/// 1. Retrieves and validates round 1 secret
/// 2. Decodes all round 1 packages from other participants
/// 3. Computes commitment hash for HPKE context binding
/// 4. Generates round 2 packages via FROST DKG part2
/// 5. Encrypts each round 2 package to recipient's HPKE public key
/// 6. Stores round 2 secret for finalization
macro_rules! impl_dkg_round2 {
    ($fn_name:ident, $frost:ident) => {
        #[allow(clippy::too_many_lines)]
        fn $fn_name(
            &self,
            session_id: &SessionId,
            round1_packages: &HashMap<ParticipantId, String>,
            participant_hpke_pubkeys: &HashMap<ParticipantId, String>,
        ) -> SignerResult<SignerDkgRound2Response> {
            let session_key = session_id.to_string();

            let stored_secret = self.take_round1_secret(&session_key)?;
            if stored_secret.ciphersuite != self.ciphersuite {
                return Err(SignerError::InvalidInput(format!(
                    "Ciphersuite mismatch for DKG round1 secret: expected {}, got {}",
                    self.ciphersuite, stored_secret.ciphersuite
                )));
            }

            let round1_secret =
                $frost::keys::dkg::round1::SecretPackage::deserialize(&stored_secret.bytes)
                    .map_err(|e| {
                        SignerError::Deserialization(format!("Invalid round 1 secret: {e}"))
                    })?;

            // Decode packages and collect raw bytes for commitment hash
            let mut decoded_packages: BTreeMap<
                $frost::Identifier,
                $frost::keys::dkg::round1::Package,
            > = BTreeMap::new();
            let mut package_bytes_map: BTreeMap<u16, Vec<u8>> = BTreeMap::new();

            for (&participant_id, package_b64) in round1_packages {
                let package_bytes = BASE64.decode(package_b64).map_err(|e| {
                    SignerError::Deserialization(format!(
                        "Invalid round 1 package base64 for {participant_id}: {e}"
                    ))
                })?;

                package_bytes_map.insert(participant_id.get(), package_bytes.clone());

                if participant_id == self.participant_id {
                    continue;
                }

                let identifier = $frost::Identifier::try_from(participant_id.get()).map_err(|e| {
                    SignerError::InvalidParticipant(format!(
                        "Invalid identifier {participant_id}: {e}"
                    ))
                })?;
                let package =
                    $frost::keys::dkg::round1::Package::deserialize(&package_bytes).map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid round 1 package for {participant_id}: {e}"
                        ))
                    })?;
                decoded_packages.insert(identifier, package);
            }

            // Compute commitment hash for HPKE context binding (RFC 9591 §A.2.2)
            let package_refs: BTreeMap<u16, &[u8]> = package_bytes_map
                .iter()
                .map(|(k, v)| (*k, v.as_slice()))
                .collect();
            let commitment_hash = hpke_crypto::compute_commitment_hash(&package_refs);

            let (round2_secret, round2_packages) =
                $frost::keys::dkg::part2(round1_secret, &decoded_packages)
                    .map_err(|e| SignerError::DkgFailed(format!("Round 2 generation failed: {e}")))?;

            let mut identifier_to_participant: HashMap<$frost::Identifier, ParticipantId> =
                HashMap::new();
            for &participant_id in participant_hpke_pubkeys.keys() {
                if let Ok(id) = $frost::Identifier::try_from(participant_id.get()) {
                    identifier_to_participant.insert(id, participant_id);
                }
            }

            let mut encrypted_packages: HashMap<ParticipantId, String> = HashMap::new();
            for (identifier, package) in round2_packages {
                let to_participant_id =
                    *identifier_to_participant.get(&identifier).ok_or_else(|| {
                        SignerError::InvalidParticipant(format!(
                            "Unknown identifier in round2 packages: {identifier:?}"
                        ))
                    })?;

                if to_participant_id == self.participant_id {
                    continue;
                }

                let recipient_pubkey_b64 = participant_hpke_pubkeys
                    .get(&to_participant_id)
                    .ok_or_else(|| {
                        SignerError::InvalidParticipant(format!(
                            "No HPKE pubkey for participant {to_participant_id}"
                        ))
                    })?;

                let recipient_pubkey = HpkeKeyPair::public_key_from_base64(recipient_pubkey_b64)?;

                let package_bytes = package.serialize().map_err(|e| {
                    SignerError::Serialization(format!(
                        "Failed to serialize round 2 package for {to_participant_id}: {e}"
                    ))
                })?;

                let info = hpke_crypto::dkg_round2_info(
                    session_id,
                    self.participant_id.get(),
                    to_participant_id.get(),
                    Some(&commitment_hash),
                );
                let encrypted =
                    hpke_crypto::encrypt_to_base64(&recipient_pubkey, &package_bytes, &info)?;

                encrypted_packages.insert(to_participant_id, encrypted);
            }

            let round2_secret_bytes = round2_secret.serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize round 2 secret: {e}"))
            })?;
            let round2_secret_key = format!("{session_key}_round2");
            self.storage
                .put_key_share(&round2_secret_key, &round2_secret_bytes)?;

            tracing::info!(
                signer_id = %self.signer_id,
                session_id = %session_id,
                ciphersuite = %self.ciphersuite,
                recipients = ?encrypted_packages.keys().collect::<Vec<_>>(),
                "Generated DKG round 2 packages"
            );

            Ok(SignerDkgRound2Response {
                packages: encrypted_packages,
            })
        }
    };
}

/// Generate DKG finalize implementation for a specific ciphersuite.
///
/// Creates a function that:
/// 1. Retrieves round 2 secret from storage
/// 2. Decodes round 1 packages and computes commitment hash
/// 3. Decrypts round 2 packages using HPKE
/// 4. Finalizes DKG via FROST part3
/// 5. Stores key package and public key package
/// 6. Returns group public key and verifying share
macro_rules! impl_dkg_finalize {
    ($fn_name:ident, $frost:ident) => {
        #[allow(clippy::too_many_lines)]
        fn $fn_name(
            &self,
            session_id: &SessionId,
            round1_packages: &HashMap<ParticipantId, String>,
            round2_packages: &HashMap<ParticipantId, String>,
        ) -> SignerResult<SignerDkgFinalizeResponse> {
            let session_key = session_id.to_string();

            let round2_secret_key = format!("{session_key}_round2");
            let round2_secret_bytes = self
                .storage
                .get_key_share(&round2_secret_key)?
                .ok_or_else(|| {
                    SignerError::SessionNotFound(format!(
                        "No round 2 secret for session {session_id}"
                    ))
                })?;
            let round2_secret =
                $frost::keys::dkg::round2::SecretPackage::deserialize(&round2_secret_bytes)
                    .map_err(|e| {
                        SignerError::Deserialization(format!("Invalid round 2 secret: {e}"))
                    })?;

            // Decode round 1 packages and compute commitment hash
            let mut decoded_round1: BTreeMap<
                $frost::Identifier,
                $frost::keys::dkg::round1::Package,
            > = BTreeMap::new();
            let mut package_bytes_map: BTreeMap<u16, Vec<u8>> = BTreeMap::new();

            for (&participant_id, package_b64) in round1_packages {
                let package_bytes = BASE64.decode(package_b64).map_err(|e| {
                    SignerError::Deserialization(format!(
                        "Invalid round 1 package base64 for {participant_id}: {e}"
                    ))
                })?;

                package_bytes_map.insert(participant_id.get(), package_bytes.clone());

                if participant_id == self.participant_id {
                    continue;
                }

                let identifier = $frost::Identifier::try_from(participant_id.get()).map_err(|e| {
                    SignerError::InvalidParticipant(format!(
                        "Invalid identifier {participant_id}: {e}"
                    ))
                })?;
                let package =
                    $frost::keys::dkg::round1::Package::deserialize(&package_bytes).map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid round 1 package for {participant_id}: {e}"
                        ))
                    })?;
                decoded_round1.insert(identifier, package);
            }

            // Compute commitment hash for HPKE decryption
            let package_refs: BTreeMap<u16, &[u8]> = package_bytes_map
                .iter()
                .map(|(k, v)| (*k, v.as_slice()))
                .collect();
            let commitment_hash = hpke_crypto::compute_commitment_hash(&package_refs);

            let mut decoded_round2: BTreeMap<
                $frost::Identifier,
                $frost::keys::dkg::round2::Package,
            > = BTreeMap::new();
            for (&from_participant_id, encrypted_b64) in round2_packages {
                let info = hpke_crypto::dkg_round2_info(
                    session_id,
                    from_participant_id.get(),
                    self.participant_id.get(),
                    Some(&commitment_hash),
                );
                let package_bytes = hpke_crypto::decrypt_from_base64(
                    self.hpke_keypair.secret_key(),
                    encrypted_b64,
                    &info,
                )?;

                let identifier =
                    $frost::Identifier::try_from(from_participant_id.get()).map_err(|e| {
                        SignerError::InvalidParticipant(format!(
                            "Invalid identifier {from_participant_id}: {e}"
                        ))
                    })?;
                let package =
                    $frost::keys::dkg::round2::Package::deserialize(&package_bytes).map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid round 2 package from {from_participant_id}: {e}"
                        ))
                    })?;
                decoded_round2.insert(identifier, package);
            }

            let (key_package, pubkey_package) =
                $frost::keys::dkg::part3(&round2_secret, &decoded_round1, &decoded_round2)
                    .map_err(|e| SignerError::DkgFailed(format!("DKG finalization failed: {e}")))?;

            let group_pubkey_bytes = pubkey_package.verifying_key().serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize group key: {e}"))
            })?;
            let group_pubkey = hex::encode(&group_pubkey_bytes);

            let public_key_package_bytes = pubkey_package.serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize public key package: {e}"))
            })?;

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

            let key_package_bytes = key_package.serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize key package: {e}"))
            })?;

            let share_key = self.share_key(&group_pubkey);
            self.storage.put_key_share(&share_key, &key_package_bytes)?;

            let pubkey_key = self.pubkey_package_key(&group_pubkey);
            self.storage
                .put_key_share(&pubkey_key, &public_key_package_bytes)?;

            self.storage.delete_key_share(&round2_secret_key)?;

            tracing::info!(
                signer_id = %self.signer_id,
                session_id = %session_id,
                ciphersuite = %self.ciphersuite,
                group_pubkey = %group_pubkey,
                "DKG finalized, key share stored"
            );

            Ok(SignerDkgFinalizeResponse {
                group_pubkey,
                public_key_package: hex::encode(&public_key_package_bytes),
                verifying_share: verifying_share_hex,
            })
        }
    };
}

/// Generate signing commitment implementation for a specific ciphersuite.
///
/// Creates a function that:
/// 1. Loads key package from storage
/// 2. Generates nonces and commitment via FROST round1::commit
/// 3. Stores nonces for partial signature generation
/// 4. Returns serialized commitment
macro_rules! impl_sign_commit {
    ($fn_name:ident, $frost:ident) => {
        fn $fn_name(
            &self,
            session_id: &SessionId,
            group_pubkey: &str,
        ) -> SignerResult<SignerCommitResponse> {
            let share_key = self.share_key(group_pubkey);
            let key_package_bytes = self.storage.get_key_share(&share_key)?.ok_or_else(|| {
                SignerError::KeyShareNotFound(format!(
                    "No key share for group {} participant {}",
                    group_pubkey, self.participant_id
                ))
            })?;
            let key_package = $frost::keys::KeyPackage::deserialize(&key_package_bytes)
                .map_err(|e| SignerError::Deserialization(format!("Invalid key package: {e}")))?;

            let (nonces, commitments) =
                $frost::round1::commit(key_package.signing_share(), &mut OsRng);

            let nonces_bytes = nonces.serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize signing nonces: {e}"))
            })?;
            let nonces_key = (group_pubkey.to_string(), session_id.to_string());
            self.store_signing_nonces(nonces_key, nonces_bytes)?;

            let commitment_bytes = commitments.serialize().map_err(|e| {
                SignerError::Serialization(format!("Failed to serialize commitment: {e}"))
            })?;

            tracing::info!(
                signer_id = %self.signer_id,
                session_id = %session_id,
                ciphersuite = %self.ciphersuite,
                "Generated signing commitment"
            );

            Ok(SignerCommitResponse {
                commitment: BASE64.encode(&commitment_bytes),
            })
        }
    };
}

/// Generate partial signature implementation for a specific ciphersuite.
///
/// Creates a function that:
/// 1. Loads key package and public key package from storage
/// 2. Retrieves and validates stored nonces
/// 3. Decodes all commitments from participants
/// 4. Creates signing package and generates partial signature via FROST round2::sign
/// 5. Returns serialized signature share
macro_rules! impl_sign_partial {
    ($fn_name:ident, $frost:ident) => {
        fn $fn_name(
            &self,
            session_id: &SessionId,
            group_pubkey: &str,
            message: &[u8],
            all_commitments: &HashMap<ParticipantId, String>,
        ) -> SignerResult<SignerPartialSignResponse> {
            let share_key = self.share_key(group_pubkey);
            let key_package_bytes = self.storage.get_key_share(&share_key)?.ok_or_else(|| {
                SignerError::KeyShareNotFound(format!(
                    "No key share for group {} participant {}",
                    group_pubkey, self.participant_id
                ))
            })?;
            let key_package = $frost::keys::KeyPackage::deserialize(&key_package_bytes)
                .map_err(|e| SignerError::Deserialization(format!("Invalid key package: {e}")))?;

            let pubkey_key = self.pubkey_package_key(group_pubkey);
            let pubkey_package_bytes = self.storage.get_key_share(&pubkey_key)?.ok_or_else(|| {
                SignerError::KeyShareNotFound(format!(
                    "No public key package for group {group_pubkey}"
                ))
            })?;
            let _pubkey_package = $frost::keys::PublicKeyPackage::deserialize(&pubkey_package_bytes)
                .map_err(|e| {
                    SignerError::Deserialization(format!("Invalid public key package: {e}"))
                })?;

            let nonces_key = (group_pubkey.to_string(), session_id.to_string());
            let stored_nonces = self.take_signing_nonces(&nonces_key)?;
            if stored_nonces.ciphersuite != self.ciphersuite {
                return Err(SignerError::InvalidInput(format!(
                    "Ciphersuite mismatch for signing nonces: expected {}, got {}",
                    self.ciphersuite, stored_nonces.ciphersuite
                )));
            }
            let nonces = $frost::round1::SigningNonces::deserialize(&stored_nonces.bytes)
                .map_err(|e| SignerError::Deserialization(format!("Invalid signing nonces: {e}")))?;

            let mut decoded_commitments: BTreeMap<
                $frost::Identifier,
                $frost::round1::SigningCommitments,
            > = BTreeMap::new();
            for (&participant_id, commitment_b64) in all_commitments {
                let commitment_bytes = BASE64.decode(commitment_b64).map_err(|e| {
                    SignerError::Deserialization(format!(
                        "Invalid commitment base64 for {participant_id}: {e}"
                    ))
                })?;
                let identifier = $frost::Identifier::try_from(participant_id.get()).map_err(|e| {
                    SignerError::InvalidParticipant(format!(
                        "Invalid identifier {participant_id}: {e}"
                    ))
                })?;
                let commitment =
                    $frost::round1::SigningCommitments::deserialize(&commitment_bytes).map_err(
                        |e| {
                            SignerError::Deserialization(format!(
                                "Invalid commitment for {participant_id}: {e}"
                            ))
                        },
                    )?;
                decoded_commitments.insert(identifier, commitment);
            }

            let signing_package = $frost::SigningPackage::new(decoded_commitments, message);

            let signature_share =
                $frost::round2::sign(&signing_package, &nonces, &key_package).map_err(|e| {
                    SignerError::SigningFailed(format!("Partial signature generation failed: {e}"))
                })?;

            let signature_share_bytes = signature_share.serialize();

            tracing::info!(
                signer_id = %self.signer_id,
                session_id = %session_id,
                ciphersuite = %self.ciphersuite,
                "Generated partial signature"
            );

            Ok(SignerPartialSignResponse {
                partial_signature: BASE64.encode(&signature_share_bytes),
            })
        }
    };
}

// =============================================================================
// Decoder Macros
// =============================================================================

/// Generate public key package decoder for a specific ciphersuite.
///
/// Creates a function that decodes a hex-encoded public key package.
macro_rules! impl_decode_pubkey_package {
    ($fn_name:ident, $frost:ident) => {
        pub fn $fn_name(hex_str: &str) -> SignerResult<$frost::keys::PublicKeyPackage> {
            let bytes = hex::decode(hex_str).map_err(|e| {
                SignerError::Deserialization(format!("Invalid public key package hex: {e}"))
            })?;
            $frost::keys::PublicKeyPackage::deserialize(&bytes).map_err(|e| {
                SignerError::Deserialization(format!("Invalid public key package: {e}"))
            })
        }
    };
}

/// Generate signing commitments decoder for a specific ciphersuite.
///
/// Creates a function that decodes base64-encoded signing commitments from a HashMap.
macro_rules! impl_decode_commitments {
    ($fn_name:ident, $frost:ident) => {
        pub fn $fn_name(
            commitments: &HashMap<ParticipantId, String>,
        ) -> SignerResult<BTreeMap<$frost::Identifier, $frost::round1::SigningCommitments>> {
            let mut result = BTreeMap::new();
            for (&participant_id, commitment_b64) in commitments {
                let commitment_bytes = BASE64.decode(commitment_b64).map_err(|e| {
                    SignerError::Deserialization(format!(
                        "Invalid commitment base64 for {participant_id}: {e}"
                    ))
                })?;
                let identifier =
                    $frost::Identifier::try_from(participant_id.get()).map_err(|e| {
                        SignerError::InvalidParticipant(format!(
                            "Invalid identifier {participant_id}: {e}"
                        ))
                    })?;
                let commitment = $frost::round1::SigningCommitments::deserialize(&commitment_bytes)
                    .map_err(|e| {
                        SignerError::Deserialization(format!(
                            "Invalid commitment for {participant_id}: {e}"
                        ))
                    })?;
                result.insert(identifier, commitment);
            }
            Ok(result)
        }
    };
}

/// Generate signature shares decoder for a specific ciphersuite.
///
/// Creates a function that decodes base64-encoded signature shares from a HashMap.
macro_rules! impl_decode_signature_shares {
    ($fn_name:ident, $frost:ident) => {
        pub fn $fn_name(
            partials: &HashMap<ParticipantId, String>,
        ) -> SignerResult<BTreeMap<$frost::Identifier, $frost::round2::SignatureShare>> {
            let mut result = BTreeMap::new();
            for (&participant_id, partial_b64) in partials {
                let partial_bytes = BASE64.decode(partial_b64).map_err(|e| {
                    SignerError::Deserialization(format!(
                        "Invalid partial signature base64 for {participant_id}: {e}"
                    ))
                })?;
                let identifier =
                    $frost::Identifier::try_from(participant_id.get()).map_err(|e| {
                        SignerError::InvalidParticipant(format!(
                            "Invalid identifier {participant_id}: {e}"
                        ))
                    })?;
                let signature_share = $frost::round2::SignatureShare::deserialize(&partial_bytes)
                    .map_err(|e| {
                    SignerError::Deserialization(format!(
                        "Invalid signature share for {participant_id}: {e}"
                    ))
                })?;
                result.insert(identifier, signature_share);
            }
            Ok(result)
        }
    };
}

/// Generate culprit extractor for a specific ciphersuite.
///
/// Creates a function that extracts culprit participant ID from FROST aggregation errors.
///
/// # Serialization Format
/// Different FROST ciphersuites use different scalar encodings:
/// - secp256k1: big-endian (identifier in last bytes)
/// - ed25519: little-endian (identifier in first bytes)
///
/// This macro requires the endianness to be specified. Use:
/// - `big` for secp256k1
/// - `little` for ed25519
///
/// Validated by test `test_identifier_serialization_format`.
macro_rules! impl_extract_culprit {
    ($fn_name:ident, $frost:ident, big) => {
        pub fn $fn_name(err: &$frost::Error) -> SignerError {
            match err {
                $frost::Error::InvalidSignatureShare { culprit } => {
                    let bytes = culprit.serialize();
                    let len = bytes.len();
                    let culprit_id = if len >= 2 {
                        // secp256k1 uses big-endian: value in last bytes
                        u16::from_be_bytes([bytes[len - 2], bytes[len - 1]])
                    } else {
                        tracing::warn!(
                            "Unexpected identifier serialization length: {len}, defaulting to 0"
                        );
                        0
                    };
                    SignerError::InvalidSignatureShare {
                        culprits: vec![culprit_id],
                    }
                }
                _ => SignerError::AggregationFailed(format!("Aggregation failed: {err}")),
            }
        }
    };
    ($fn_name:ident, $frost:ident, little) => {
        pub fn $fn_name(err: &$frost::Error) -> SignerError {
            match err {
                $frost::Error::InvalidSignatureShare { culprit } => {
                    let bytes = culprit.serialize();
                    let culprit_id = if bytes.len() >= 2 {
                        // ed25519 uses little-endian: value in first bytes
                        u16::from_le_bytes([bytes[0], bytes[1]])
                    } else if !bytes.is_empty() {
                        u16::from(bytes[0])
                    } else {
                        tracing::warn!(
                            "Unexpected identifier serialization length: {}, defaulting to 0",
                            bytes.len()
                        );
                        0
                    };
                    SignerError::InvalidSignatureShare {
                        culprits: vec![culprit_id],
                    }
                }
                _ => SignerError::AggregationFailed(format!("Aggregation failed: {err}")),
            }
        }
    };
}

pub(crate) use impl_decode_commitments;
pub(crate) use impl_decode_pubkey_package;
pub(crate) use impl_decode_signature_shares;
pub(crate) use impl_dkg_finalize;
pub(crate) use impl_dkg_round1;
pub(crate) use impl_dkg_round2;
pub(crate) use impl_extract_culprit;
pub(crate) use impl_sign_commit;
pub(crate) use impl_sign_partial;

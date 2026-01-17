//! Decoder helpers for FROST protocol types.
//!
//! Each decoder function is generated via macros in `macros.rs`,
//! providing identical implementations for both ciphersuites.

#![allow(clippy::implicit_hasher)]

use std::collections::{BTreeMap, HashMap};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use frost_ed25519 as frost_ed;
use frost_secp256k1 as frost_secp;

use crate::error::{SignerError, SignerResult};
use crate::frost::macros::{
    impl_decode_commitments, impl_decode_pubkey_package, impl_decode_signature_shares,
    impl_extract_culprit,
};
use crate::frost::types::ParticipantId;

// =============================================================================
// secp256k1 Decoders
// =============================================================================

impl_decode_pubkey_package!(decode_pubkey_package_secp, frost_secp);
impl_decode_commitments!(decode_commitments_secp, frost_secp);
impl_decode_signature_shares!(decode_signature_shares_secp, frost_secp);
impl_extract_culprit!(extract_culprit_from_secp_error, frost_secp, big);

// =============================================================================
// Ed25519 Decoders
// =============================================================================

impl_decode_pubkey_package!(decode_pubkey_package_ed, frost_ed);
impl_decode_commitments!(decode_commitments_ed, frost_ed);
impl_decode_signature_shares!(decode_signature_shares_ed, frost_ed);
impl_extract_culprit!(extract_culprit_from_ed_error, frost_ed, little);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invalid_hex_pubkey_package() {
        let result = decode_pubkey_package_secp("not_valid_hex!");
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid"));
    }

    #[test]
    fn test_empty_commitments() {
        let empty: HashMap<ParticipantId, String> = HashMap::new();
        let result = decode_commitments_secp(&empty);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_invalid_base64_commitment() {
        let mut commitments = HashMap::new();
        commitments.insert(
            ParticipantId::new_unwrap(1),
            "not_valid_base64!!!".to_string(),
        );
        let result = decode_commitments_secp(&commitments);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid"));
    }

    /// Verify FROST Identifier serialization formats for culprit extraction.
    ///
    /// secp256k1 uses big-endian scalars (value in last bytes),
    /// ed25519 uses little-endian scalars (value in first bytes).
    #[test]
    fn test_identifier_serialization_format() {
        // secp256k1: big-endian (value in last bytes)
        let id_secp = frost_secp::Identifier::try_from(42u16).unwrap();
        let bytes_secp = id_secp.serialize();
        let len = bytes_secp.len();
        let extracted_secp = u16::from_be_bytes([bytes_secp[len - 2], bytes_secp[len - 1]]);
        assert_eq!(extracted_secp, 42, "secp256k1 big-endian extraction failed");

        // ed25519: little-endian (value in first bytes)
        let id_ed = frost_ed::Identifier::try_from(99u16).unwrap();
        let bytes_ed = id_ed.serialize();
        let extracted_ed = u16::from_le_bytes([bytes_ed[0], bytes_ed[1]]);
        assert_eq!(extracted_ed, 99, "ed25519 little-endian extraction failed");
    }
}

//! Shared recovery signing message validation.
//!
//! Both the coordinator and individual signers validate the canonical
//! recovery intent format independently (defense in depth).

use uuid::Uuid;

use crate::error::{SignerError, SignerResult};

const RECOVERY_MESSAGE_PREFIX: &str = "zentity-recovery-intent";
const RECOVERY_MESSAGE_VERSION: &str = "v1";

/// Validate that a UTF-8 recovery signing message has canonical `v1` format:
/// `zentity-recovery-intent:v1:<challenge_id>:<challenge_nonce>`
pub(crate) fn validate(message: &str) -> SignerResult<()> {
    let parts: Vec<&str> = message.split(':').collect();
    if parts.len() != 4 {
        return Err(SignerError::InvalidInput(
            "Invalid recovery signing message format".to_string(),
        ));
    }

    if parts[0] != RECOVERY_MESSAGE_PREFIX || parts[1] != RECOVERY_MESSAGE_VERSION {
        return Err(SignerError::InvalidInput(
            "Invalid recovery signing message header".to_string(),
        ));
    }

    Uuid::parse_str(parts[2]).map_err(|_| {
        SignerError::InvalidInput("Invalid recovery challenge_id in signing message".to_string())
    })?;
    Uuid::parse_str(parts[3]).map_err(|_| {
        SignerError::InvalidInput("Invalid recovery challenge_nonce in signing message".to_string())
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_canonical_v1() {
        let message = "zentity-recovery-intent:v1:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";
        assert!(validate(message).is_ok());
    }

    #[test]
    fn rejects_legacy_prefix() {
        let message =
            "recovery:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";
        assert!(validate(message).is_err());
    }

    #[test]
    fn rejects_wrong_version() {
        let message = "zentity-recovery-intent:v2:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";
        assert!(validate(message).is_err());
    }

    #[test]
    fn rejects_invalid_uuid() {
        let message = "zentity-recovery-intent:v1:not-a-uuid:22222222-2222-4222-8222-222222222222";
        assert!(validate(message).is_err());
    }
}

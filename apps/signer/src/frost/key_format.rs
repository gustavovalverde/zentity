//! Helpers for formatting group public keys for external consumers.

use crate::error::{SignerError, SignerResult};

/// Derive secp256k1 X coordinate and parity from a compressed group public key.
///
/// Expects SEC1 compressed format (33 bytes, 0x02/0x03 prefix) encoded as hex.
pub fn secp256k1_x_parity_from_group_pubkey_hex(pubkey_hex: &str) -> SignerResult<(String, u8)> {
    let bytes = hex::decode(pubkey_hex)
        .map_err(|e| SignerError::InvalidInput(format!("Invalid group pubkey hex: {e}")))?;

    if bytes.len() != 33 {
        return Err(SignerError::InvalidInput(format!(
            "Invalid secp256k1 pubkey length: expected 33 bytes, got {}",
            bytes.len()
        )));
    }

    let prefix = bytes[0];
    let parity = match prefix {
        0x02 => 27,
        0x03 => 28,
        _ => {
            return Err(SignerError::InvalidInput(format!(
                "Invalid secp256k1 pubkey prefix: 0x{prefix:02x}"
            )));
        }
    };

    let x_hex = hex::encode(&bytes[1..]);
    Ok((x_hex, parity))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secp256k1_x_parity_from_pubkey() {
        // Compressed pubkey with even Y (0x02 prefix).
        let pubkey_hex = "02dff1d77f2a671c5f5d2d8bb1efb930a8b1b1fca2b5d7f1e9b76d8d4c5d7e9a0b";

        let (x, parity) = secp256k1_x_parity_from_group_pubkey_hex(pubkey_hex).unwrap();
        assert_eq!(parity, 27);
        assert_eq!(x.len(), 64);
    }
}

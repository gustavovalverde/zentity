//! Versioned wire format for TFHE keys and ciphertexts.
//!
//! Uses tfhe-rs `safe_serialization`, the same format the browser client
//! writes with `safe_serialize`, so payloads stay readable across tfhe minors.

use serde::{de::DeserializeOwned, Serialize};
use tfhe::named::Named;
use tfhe::safe_serialization::{safe_deserialize, safe_serialize};
use tfhe::{Unversionize, Versionize};

use crate::error::FheError;

/// Upper bound for one serialized TFHE object. A compressed server key is
/// about 60 MB, so this leaves headroom while still bounding allocation on
/// untrusted input.
pub const MAX_TFHE_SERIALIZED_BYTES: u64 = 128 * 1024 * 1024;

pub fn encode_tfhe_binary<T: Serialize + Versionize + Named>(
    value: &T,
) -> Result<Vec<u8>, FheError> {
    let mut buffer = Vec::new();
    safe_serialize(value, &mut buffer, MAX_TFHE_SERIALIZED_BYTES)
        .map_err(|error| FheError::Internal(format!("Failed to serialize TFHE value: {error}")))?;
    Ok(buffer)
}

pub fn decode_tfhe_binary<T: DeserializeOwned + Unversionize + Named>(
    value: &[u8],
) -> Result<T, FheError> {
    safe_deserialize(value, MAX_TFHE_SERIALIZED_BYTES)
        .map_err(|error| FheError::InvalidInput(format!("Invalid TFHE payload: {error}")))
}

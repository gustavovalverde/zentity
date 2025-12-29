use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{de::DeserializeOwned, Serialize};

use crate::error::FheError;

pub fn encode_bincode_base64<T: Serialize>(value: &T) -> Result<String, FheError> {
    let bytes = bincode::serialize(value)?;
    Ok(BASE64.encode(bytes))
}

pub fn decode_bincode_base64<T: DeserializeOwned>(value: &str) -> Result<T, FheError> {
    let bytes = BASE64.decode(value)?;
    Ok(bincode::deserialize(&bytes)?)
}

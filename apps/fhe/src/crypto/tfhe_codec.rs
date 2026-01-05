use serde::{de::DeserializeOwned, Serialize};

use crate::error::FheError;

pub fn encode_tfhe_binary<T: Serialize>(value: &T) -> Result<Vec<u8>, FheError> {
    Ok(bincode::serialize(value)?)
}

pub fn decode_tfhe_binary<T: DeserializeOwned>(value: &[u8]) -> Result<T, FheError> {
    Ok(bincode::deserialize(value)?)
}

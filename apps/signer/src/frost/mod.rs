//! FROST threshold signing implementation.
//!
//! This module contains:
//! - `types`: Session and message types
//! - `coordinator`: DKG and signing orchestration
//! - `signer_logic`: Key share operations and partial signing
//! - `decoders`: FROST type decoding helpers
//! - `macros`: Declarative macros for ciphersuite abstraction
//! - `hpke_crypto`: HPKE encryption for DKG round-2 shares
//! - `jwt_verification`: Guardian assertion JWT verification

pub mod coordinator;
pub mod decoders;
pub mod hpke_crypto;
pub mod jwt_verification;
pub mod key_format;
mod macros;
pub mod signer_logic;
pub mod types;

// Re-export key types
pub use coordinator::Coordinator;
pub use jwt_verification::{GuardianAssertionClaims, GuardianType, JwtVerifier};
pub use signer_logic::SignerService;
pub use types::*;

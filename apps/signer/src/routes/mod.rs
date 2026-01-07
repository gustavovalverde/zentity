//! HTTP routes for the signer service.
//!
//! Routes are organized by functionality:
//! - `health`: Health check and build info (both roles)
//! - `dkg`: DKG endpoints (coordinator)
//! - `signing`: Signing endpoints (coordinator)
//! - `signer_routes`: Signer-specific endpoints (signer)

pub mod dkg;
pub mod health;
pub mod signer_routes;
pub mod signing;

pub use health::{build_info, health};

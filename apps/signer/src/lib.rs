// Crate-level lint configuration
// Allow noisy pedantic/cargo lints that aren't worth fixing individually
#![allow(clippy::multiple_crate_versions)] // Transitive deps, can't easily fix
#![allow(clippy::missing_errors_doc)] // Would require extensive doc changes
#![allow(clippy::missing_panics_doc)] // Would require extensive doc changes
#![allow(clippy::must_use_candidate)] // Too many false positives for internal APIs
#![allow(clippy::module_name_repetitions)] // Acceptable for clarity (e.g., SignerError in error mod)
#![allow(clippy::doc_markdown)] // Too strict about backticks in docs
#![allow(clippy::missing_const_for_fn)] // Often debatable, runtime doesn't benefit

//! FROST Signer Service
//!
//! A threshold signing service implementing FROST (Flexible Round-Optimized Schnorr Threshold)
//! for Zentity's social recovery and threshold registrar features.
//!
//! ## Architecture
//!
//! The service runs as two distinct binaries:
//!
//! - **Coordinator** (port 5002): Orchestrates DKG and signing sessions, validates requests,
//!   and aggregates partial signatures. Never sees plaintext key shares.
//!
//! - **Signer** (ports 5101+): Isolated instances that each hold exactly one key share.
//!   Produces partial signatures only when presented with valid guardian assertions.
//!
//! ## Security Model
//!
//! - **t-of-n threshold**: No single party can forge a signature
//! - **Share isolation**: Each signer holds exactly one share in envelope-encrypted storage
//! - **mTLS**: Coordinator-to-signer communication uses mutual TLS
//! - **Guardian binding**: Signing requires JWT assertions bound to (guardian, challenge, session)
//! - **HPKE encryption**: DKG round-2 shares are encrypted to recipient's public key
//!
//! ## Ciphersuites
//!
//! Supports both secp256k1 (blockchain) and ed25519 (general purpose) ciphersuites.

pub mod audit;
pub mod config;
pub mod error;
pub mod frost;
pub mod middleware;
pub mod routes;
pub mod storage;
pub mod tls;

#[cfg(feature = "otel")]
pub mod telemetry;

#[cfg(not(feature = "otel"))]
pub mod telemetry {
    //! Stub telemetry module when OpenTelemetry is disabled.

    use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

    /// Initialize tracing with console output only.
    pub fn init_tracing() {
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "signer_service=info,actix_web=info".into());
        let fmt_layer = tracing_subscriber::fmt::layer();

        tracing_subscriber::registry()
            .with(env_filter)
            .with(fmt_layer)
            .init();
    }

    /// No-op shutdown when OpenTelemetry is disabled.
    pub fn shutdown_tracing() {}
}

// Re-export commonly used types
pub use config::{Role, Settings};
pub use error::SignerError;
pub use frost::{Coordinator, SignerService};

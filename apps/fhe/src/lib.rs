//! FHE Service Library
//!
//! Provides FHE-based cryptographic operations for age verification,
//! compliance level, country code, and liveness scoring.
//!
//! This library module exposes the crypto primitives for use in integration tests.

pub mod app;
pub mod auth;
pub mod crypto;
pub mod error;
pub mod routes;
pub mod settings;
pub mod telemetry;
pub mod test_support;
pub mod transport;

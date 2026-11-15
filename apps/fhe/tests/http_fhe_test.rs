//! Consolidated HTTP integration tests for FHE service.
//!
//! This single test binary runs all FHE-heavy HTTP tests, ensuring TFHE keys
//! are generated only ONCE and reused across all tests. This dramatically
//! reduces test execution time (from ~8x key generations to 1x).
//!
//! # Test Modules
//!
//! - `dob` - Age verification on encrypted DOB days
//! - `batch` - Batch encryption endpoint (every attribute is encrypted through it)
//! - `liveness` - Liveness threshold verification
//! - `keys` - Key registration endpoint
//! - `error` - Error response format tests

mod common;
mod http;

mod http_fhe;

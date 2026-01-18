//! Consolidated HTTP integration tests for FHE service.
//!
//! This single test binary runs all FHE-heavy HTTP tests, ensuring TFHE keys
//! are generated only ONCE and reused across all tests. This dramatically
//! reduces test execution time (from ~8x key generations to 1x).
//!
//! # Test Modules
//!
//! - `dob` - DOB days encryption and age verification
//! - `batch` - Batch encryption endpoint
//! - `liveness` - Liveness score encryption and threshold verification
//! - `country_code` - Country code encryption
//! - `compliance_level` - Compliance level encryption
//! - `keys` - Key registration endpoint
//! - `error` - Error response format tests

mod common;
mod http;

mod http_fhe;

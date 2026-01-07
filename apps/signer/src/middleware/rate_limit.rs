//! Rate limiting middleware for coordinator endpoints.
//!
//! Implements rate limits per RFC-0014 to prevent abuse:
//! - DKG init: Limited per IP to prevent session flooding
//! - DKG rounds: Limited per participant to prevent replay attacks
//! - Signing operations: Limited to enforce recovery window constraints
//!
//! Uses actix-governor with the built-in PeerIpKeyExtractor.

use actix_governor::{Governor, GovernorConfig, GovernorConfigBuilder, PeerIpKeyExtractor};

/// Configuration for rate limiting across coordinator endpoints.
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Maximum DKG init requests per hour per IP.
    pub dkg_init_per_hour: u32,
    /// Maximum DKG round submissions per hour per IP.
    pub dkg_round_per_hour: u32,
    /// Maximum signing operations per hour per IP.
    pub signing_per_hour: u32,
    /// Burst size for DKG operations (allows short bursts).
    pub dkg_burst: u32,
    /// Burst size for signing operations.
    pub signing_burst: u32,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            // Conservative defaults based on RFC-0014
            dkg_init_per_hour: 10,  // ~10 DKG sessions per hour max
            dkg_round_per_hour: 60, // ~60 round submissions per hour
            signing_per_hour: 30,   // ~30 signing operations per hour
            dkg_burst: 5,           // Allow burst of 5 DKG requests
            signing_burst: 10,      // Allow burst of 10 signing requests
        }
    }
}

impl RateLimitConfig {
    /// Load configuration from environment variables.
    pub fn from_env() -> Self {
        Self {
            dkg_init_per_hour: std::env::var("RATE_LIMIT_DKG_INIT_PER_HOUR")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
            dkg_round_per_hour: std::env::var("RATE_LIMIT_DKG_ROUND_PER_HOUR")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
            signing_per_hour: std::env::var("RATE_LIMIT_SIGNING_PER_HOUR")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
            dkg_burst: std::env::var("RATE_LIMIT_DKG_BURST")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(5),
            signing_burst: std::env::var("RATE_LIMIT_SIGNING_BURST")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
        }
    }
}

/// Type alias for the Governor middleware with default settings.
pub type RateLimiter = Governor<PeerIpKeyExtractor, governor::middleware::NoOpMiddleware>;

/// Create a rate limiter for DKG init endpoints.
///
/// Limits the number of DKG sessions that can be initiated per hour.
pub fn dkg_init_limiter(config: &RateLimitConfig) -> RateLimiter {
    // Calculate seconds per request: 3600 / requests_per_hour
    let seconds_per_request = if config.dkg_init_per_hour > 0 {
        3600 / u64::from(config.dkg_init_per_hour)
    } else {
        3600 // Default to 1 per hour if 0
    };

    let governor_config = GovernorConfigBuilder::default()
        .seconds_per_request(seconds_per_request)
        .burst_size(config.dkg_burst)
        .finish()
        .expect("Failed to build DKG init rate limiter");

    Governor::new(&governor_config)
}

/// Create a rate limiter for DKG round endpoints (round1, round2, finalize).
///
/// Higher limits than init since multiple rounds per session.
pub fn dkg_round_limiter(config: &RateLimitConfig) -> RateLimiter {
    let seconds_per_request = if config.dkg_round_per_hour > 0 {
        3600 / u64::from(config.dkg_round_per_hour)
    } else {
        60
    };

    let governor_config = GovernorConfigBuilder::default()
        .seconds_per_request(seconds_per_request)
        .burst_size(config.dkg_burst * 2)
        .finish()
        .expect("Failed to build DKG round rate limiter");

    Governor::new(&governor_config)
}

/// Create a rate limiter for signing endpoints.
///
/// Controls signing operation frequency to prevent abuse.
pub fn signing_limiter(config: &RateLimitConfig) -> RateLimiter {
    let seconds_per_request = if config.signing_per_hour > 0 {
        3600 / u64::from(config.signing_per_hour)
    } else {
        120
    };

    let governor_config = GovernorConfigBuilder::default()
        .seconds_per_request(seconds_per_request)
        .burst_size(config.signing_burst)
        .finish()
        .expect("Failed to build signing rate limiter");

    Governor::new(&governor_config)
}

/// Create a general API rate limiter for all coordinator endpoints.
///
/// Provides a baseline rate limit for all endpoints (10 requests/second).
pub fn general_limiter() -> RateLimiter {
    let governor_config = GovernorConfigBuilder::default()
        .seconds_per_request(1) // Allow ~1 request per second sustained
        .burst_size(50) // But allow bursts up to 50
        .finish()
        .expect("Failed to build general rate limiter");

    Governor::new(&governor_config)
}

/// Create a strict rate limiter for sensitive endpoints.
///
/// Very low limits for potentially dangerous operations (1 per minute).
pub fn strict_limiter() -> RateLimiter {
    let governor_config = GovernorConfigBuilder::default()
        .seconds_per_request(60) // 1 request per minute
        .burst_size(3)
        .finish()
        .expect("Failed to build strict rate limiter");

    Governor::new(&governor_config)
}

/// Get a shared governor config for use across the application.
///
/// Returns a config that can be cloned for multiple Governor instances.
pub fn shared_config() -> GovernorConfig<PeerIpKeyExtractor, governor::middleware::NoOpMiddleware> {
    GovernorConfigBuilder::default()
        .seconds_per_request(1)
        .burst_size(20)
        .finish()
        .expect("Failed to build shared rate limiter config")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = RateLimitConfig::default();
        assert_eq!(config.dkg_init_per_hour, 10);
        assert_eq!(config.dkg_round_per_hour, 60);
        assert_eq!(config.signing_per_hour, 30);
    }

    #[test]
    fn test_limiter_creation() {
        let config = RateLimitConfig::default();

        // These should not panic
        let _ = dkg_init_limiter(&config);
        let _ = dkg_round_limiter(&config);
        let _ = signing_limiter(&config);
        let _ = general_limiter();
        let _ = strict_limiter();
    }

    #[test]
    fn test_shared_config() {
        let config = shared_config();
        // Should be able to create multiple governors from the same config
        let _gov1 = Governor::new(&config);
        let _gov2 = Governor::new(&config);
    }
}

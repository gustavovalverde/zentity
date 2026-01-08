//! Middleware for the signer service.
//!
//! Provides cross-cutting concerns like rate limiting that apply
//! across multiple routes.

pub mod auth;
pub mod rate_limit;

pub use auth::InternalAuth;
pub use rate_limit::{
    RateLimitConfig, RateLimiter, dkg_init_limiter, dkg_round_limiter, general_limiter,
    shared_config, signing_limiter, strict_limiter,
};

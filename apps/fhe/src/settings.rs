//! Service configuration derived from environment variables.

use std::env;
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::time::Duration;

const DEFAULT_PORT: u16 = 5001;
const DEFAULT_BODY_LIMIT_MB: usize = 64;
const DEFAULT_CONCURRENCY_LIMIT: usize = 4;
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 60_000;
const DEFAULT_TEST_TIMEOUT_MS: u64 = 180_000;

fn env_trim(name: &str) -> String {
    env::var(name).unwrap_or_default().trim().to_string()
}

fn env_lower(name: &str) -> String {
    env_trim(name).to_lowercase()
}

fn is_truthy(value: &str) -> bool {
    matches!(value.trim(), "1" | "true" | "yes")
}

#[derive(Clone, Debug)]
pub struct Settings {
    port: u16,
    host: IpAddr,
    body_limit_mb: usize,
    body_limit_bytes: usize,
    internal_token: Option<String>,
    internal_token_required: bool,
    concurrency_limit: usize,
    cpu_concurrency_limit: usize,
    request_timeout_ms: u64,
}

impl Settings {
    pub fn from_env() -> Self {
        let internal_token = env_trim("INTERNAL_SERVICE_TOKEN");
        let internal_token = if internal_token.is_empty() {
            None
        } else {
            Some(internal_token)
        };

        let node_env = env_lower("NODE_ENV");
        let app_env = env_lower("APP_ENV");
        let rust_env = env_lower("RUST_ENV");
        let is_production = matches!(node_env.as_str(), "production")
            || matches!(app_env.as_str(), "production")
            || matches!(rust_env.as_str(), "production");

        let internal_token_required =
            is_production || is_truthy(&env_lower("INTERNAL_SERVICE_TOKEN_REQUIRED"));

        let port = env_trim("PORT").parse::<u16>().unwrap_or(DEFAULT_PORT);
        let host = env_trim("HOST")
            .parse::<IpAddr>()
            .unwrap_or(IpAddr::V6(Ipv6Addr::UNSPECIFIED));
        let body_limit_mb = env_trim("FHE_BODY_LIMIT_MB")
            .parse::<usize>()
            .unwrap_or(DEFAULT_BODY_LIMIT_MB);
        let body_limit_bytes = body_limit_mb.saturating_mul(1024 * 1024);
        let concurrency_limit = env_trim("FHE_CONCURRENCY_LIMIT")
            .parse::<usize>()
            .ok()
            .filter(|value| *value > 0)
            .unwrap_or_else(|| {
                std::thread::available_parallelism()
                    .map(|value| value.get())
                    .unwrap_or(DEFAULT_CONCURRENCY_LIMIT)
            });
        let cpu_concurrency_limit = env_trim("FHE_CPU_CONCURRENCY_LIMIT")
            .parse::<usize>()
            .ok()
            .filter(|value| *value > 0)
            .unwrap_or(concurrency_limit);
        let request_timeout_ms = env_trim("FHE_REQUEST_TIMEOUT_MS")
            .parse::<u64>()
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS);

        Self {
            port,
            host,
            body_limit_mb,
            body_limit_bytes,
            internal_token,
            internal_token_required,
            concurrency_limit,
            cpu_concurrency_limit,
            request_timeout_ms,
        }
    }

    pub fn for_tests() -> Self {
        Self {
            port: DEFAULT_PORT,
            host: IpAddr::V6(Ipv6Addr::UNSPECIFIED),
            body_limit_mb: DEFAULT_BODY_LIMIT_MB,
            body_limit_bytes: DEFAULT_BODY_LIMIT_MB.saturating_mul(1024 * 1024),
            internal_token: None,
            internal_token_required: false,
            concurrency_limit: 32,
            cpu_concurrency_limit: 32,
            request_timeout_ms: DEFAULT_TEST_TIMEOUT_MS,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.internal_token_required && self.internal_token.is_none() {
            return Err("INTERNAL_SERVICE_TOKEN is required in production. \
Set INTERNAL_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN_REQUIRED=0."
                .to_string());
        }
        Ok(())
    }

    pub fn socket_addr(&self) -> SocketAddr {
        SocketAddr::new(self.host, self.port)
    }

    pub fn internal_token(&self) -> Option<String> {
        self.internal_token.clone()
    }

    pub fn internal_token_required(&self) -> bool {
        self.internal_token_required
    }

    pub fn body_limit_bytes(&self) -> usize {
        self.body_limit_bytes
    }

    pub fn body_limit_mb(&self) -> usize {
        self.body_limit_mb
    }

    pub fn with_internal_token(mut self, token: Option<String>) -> Self {
        self.internal_token = token;
        self
    }

    pub fn with_body_limit_bytes(mut self, bytes: usize) -> Self {
        self.body_limit_bytes = bytes;
        self.body_limit_mb = bytes / (1024 * 1024);
        self
    }

    pub fn concurrency_limit(&self) -> usize {
        self.concurrency_limit
    }

    pub fn cpu_concurrency_limit(&self) -> usize {
        self.cpu_concurrency_limit
    }

    pub fn request_timeout(&self) -> Duration {
        Duration::from_millis(self.request_timeout_ms)
    }

    pub fn request_timeout_ms(&self) -> u64 {
        self.request_timeout_ms
    }
}

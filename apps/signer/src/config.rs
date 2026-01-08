//! Service configuration derived from environment variables.
//!
//! Configuration is loaded once at startup and validated before the service starts.
//! The same binary can run as either coordinator or signer based on `SIGNER_ROLE`.
//!
//! ## Environment Variables
//!
//! ### Common (both roles)
//! - `SIGNER_ROLE`: "coordinator" or "signer" (required)
//! - `SIGNER_PORT`: HTTP port (default: 5002 for coordinator, 5101 for signer)
//! - `SIGNER_HOST`: Bind address (default: :: for dual-stack IPv4/IPv6)
//! - `SIGNER_DB_PATH`: Path to ReDB database file
//! - `INTERNAL_SERVICE_TOKEN`: Shared secret for web app authentication
//! - `RUST_LOG`: Log level filter
//!
//! ### Coordinator-specific
//! - `SIGNER_ENDPOINTS`: Comma-separated list of signer URLs
//! - `SIGNER_MTLS_CA_PATH`: CA certificate for verifying signers
//! - `SIGNER_MTLS_CERT_PATH`: Coordinator's client certificate
//! - `SIGNER_MTLS_KEY_PATH`: Coordinator's private key
//! - `GUARDIAN_ASSERTION_JWKS_URL`: JWKS endpoint for JWT verification
//!
//! ### Signer-specific
//! - `SIGNER_ID`: Unique identifier for this signer instance
//! - `SIGNER_CIPHERSUITE`: "secp256k1" or "ed25519"
//! - `SIGNER_KEK_PROVIDER`: "local" or "kms"
//! - `SIGNER_KEK_ID`: KMS key ID (if using KMS)

use std::env;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use serde::{Deserialize, Serialize};

// Default ports
const DEFAULT_COORDINATOR_PORT: u16 = 5002;
const DEFAULT_SIGNER_PORT: u16 = 5101;
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_BODY_LIMIT_MB: usize = 16;

/// Helper to get trimmed env var or empty string.
fn env_trim(name: &str) -> String {
    env::var(name).unwrap_or_default().trim().to_string()
}

/// Helper to get lowercase env var.
fn env_lower(name: &str) -> String {
    env_trim(name).to_lowercase()
}

/// Check if a string value is truthy.
fn is_truthy(value: &str) -> bool {
    matches!(value.trim(), "1" | "true" | "yes")
}

/// Service role: coordinator or signer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Orchestrates DKG and signing, never sees plaintext shares.
    Coordinator,
    /// Holds exactly one key share, produces partial signatures.
    Signer,
}

impl FromStr for Role {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "coordinator" => Ok(Self::Coordinator),
            "signer" => Ok(Self::Signer),
            other => Err(format!(
                "Invalid role '{other}'. Must be 'coordinator' or 'signer'."
            )),
        }
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Coordinator => write!(f, "coordinator"),
            Self::Signer => write!(f, "signer"),
        }
    }
}

/// FROST ciphersuite selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Ciphersuite {
    /// secp256k1 curve (Bitcoin, Ethereum compatible).
    #[default]
    Secp256k1,
    /// ed25519 curve (general purpose).
    Ed25519,
}

impl FromStr for Ciphersuite {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "secp256k1" => Ok(Self::Secp256k1),
            "ed25519" => Ok(Self::Ed25519),
            other => Err(format!(
                "Invalid ciphersuite '{other}'. Must be 'secp256k1' or 'ed25519'."
            )),
        }
    }
}

impl std::fmt::Display for Ciphersuite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Secp256k1 => write!(f, "secp256k1"),
            Self::Ed25519 => write!(f, "ed25519"),
        }
    }
}

/// Key Encryption Key (KEK) provider for envelope encryption.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum KekProvider {
    /// Local file-based KEK (development only).
    #[default]
    Local,
    /// AWS KMS for production envelope encryption.
    Kms,
}

impl FromStr for KekProvider {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "local" => Ok(Self::Local),
            "kms" => Ok(Self::Kms),
            other => Err(format!(
                "Invalid KEK provider '{other}'. Must be 'local' or 'kms'."
            )),
        }
    }
}

/// Service configuration.
#[derive(Debug, Clone)]
pub struct Settings {
    // Common settings
    role: Role,
    port: u16,
    host: IpAddr,
    db_path: PathBuf,
    internal_token: Option<String>,
    internal_token_required: bool,
    request_timeout_ms: u64,
    body_limit_bytes: usize,

    // Coordinator-specific
    signer_endpoints: Vec<String>,
    mtls_ca_path: Option<PathBuf>,
    mtls_cert_path: Option<PathBuf>,
    mtls_key_path: Option<PathBuf>,
    jwks_url: Option<String>,

    // Signer-specific
    signer_id: Option<String>,
    ciphersuite: Ciphersuite,
    kek_provider: KekProvider,
    kek_id: Option<String>,
}

impl Settings {
    /// Load settings from environment variables.
    ///
    /// # Panics
    ///
    /// Panics if `SIGNER_ROLE` is not set or invalid.
    #[allow(clippy::too_many_lines)]
    pub fn from_env() -> Self {
        let role_str = env_trim("SIGNER_ROLE");
        let role: Role = role_str
            .parse()
            .unwrap_or_else(|e| panic!("SIGNER_ROLE configuration error: {e}"));

        let default_port = match role {
            Role::Coordinator => DEFAULT_COORDINATOR_PORT,
            Role::Signer => DEFAULT_SIGNER_PORT,
        };

        let port = env_trim("SIGNER_PORT")
            .parse::<u16>()
            .unwrap_or(default_port);

        // Default to IPv6 unspecified (::) for dual-stack support.
        // On Linux, this accepts both IPv4 and IPv6 connections.
        let host = env_trim("SIGNER_HOST")
            .parse::<IpAddr>()
            .unwrap_or(IpAddr::V6(Ipv6Addr::UNSPECIFIED));

        let default_db_name = match role {
            Role::Coordinator => "coordinator.redb",
            Role::Signer => "signer.redb",
        };
        let db_path = env_trim("SIGNER_DB_PATH")
            .parse::<PathBuf>()
            .unwrap_or_else(|_| PathBuf::from(format!("./.data/{default_db_name}")));

        let internal_token = env_trim("INTERNAL_SERVICE_TOKEN");
        let internal_token = if internal_token.is_empty() {
            None
        } else {
            Some(internal_token)
        };

        // Determine if token is required based on environment
        let node_env = env_lower("NODE_ENV");
        let app_env = env_lower("APP_ENV");
        let rust_env = env_lower("RUST_ENV");
        let is_production = matches!(node_env.as_str(), "production")
            || matches!(app_env.as_str(), "production")
            || matches!(rust_env.as_str(), "production");
        let internal_token_required =
            is_production || is_truthy(&env_lower("INTERNAL_SERVICE_TOKEN_REQUIRED"));

        let request_timeout_ms = env_trim("SIGNER_REQUEST_TIMEOUT_MS")
            .parse::<u64>()
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS);

        let body_limit_mb = env_trim("SIGNER_BODY_LIMIT_MB")
            .parse::<usize>()
            .unwrap_or(DEFAULT_BODY_LIMIT_MB);
        let body_limit_bytes = body_limit_mb.saturating_mul(1024 * 1024);

        // Coordinator-specific settings
        let signer_endpoints: Vec<String> = env_trim("SIGNER_ENDPOINTS")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let mtls_ca_path = env_trim("SIGNER_MTLS_CA_PATH")
            .parse::<PathBuf>()
            .ok()
            .filter(|p| !p.as_os_str().is_empty());

        let mtls_cert_path = env_trim("SIGNER_MTLS_CERT_PATH")
            .parse::<PathBuf>()
            .ok()
            .filter(|p| !p.as_os_str().is_empty());

        let mtls_key_path = env_trim("SIGNER_MTLS_KEY_PATH")
            .parse::<PathBuf>()
            .ok()
            .filter(|p| !p.as_os_str().is_empty());

        let jwks_url = env_trim("GUARDIAN_ASSERTION_JWKS_URL");
        let jwks_url = if jwks_url.is_empty() {
            None
        } else {
            Some(jwks_url)
        };

        // Signer-specific settings
        let signer_id = env_trim("SIGNER_ID");
        let signer_id = if signer_id.is_empty() {
            None
        } else {
            Some(signer_id)
        };

        let ciphersuite = env_trim("SIGNER_CIPHERSUITE")
            .parse::<Ciphersuite>()
            .unwrap_or_default();

        let kek_provider = env_trim("SIGNER_KEK_PROVIDER")
            .parse::<KekProvider>()
            .unwrap_or_default();

        let kek_id = env_trim("SIGNER_KEK_ID");
        let kek_id = if kek_id.is_empty() {
            None
        } else {
            Some(kek_id)
        };

        Self {
            role,
            port,
            host,
            db_path,
            internal_token,
            internal_token_required,
            request_timeout_ms,
            body_limit_bytes,
            signer_endpoints,
            mtls_ca_path,
            mtls_cert_path,
            mtls_key_path,
            jwks_url,
            signer_id,
            ciphersuite,
            kek_provider,
            kek_id,
        }
    }

    /// Create settings for coordinator tests.
    pub fn for_coordinator_tests() -> Self {
        Self {
            role: Role::Coordinator,
            port: DEFAULT_COORDINATOR_PORT,
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            db_path: PathBuf::from("./.data/test-coordinator.redb"),
            internal_token: None,
            internal_token_required: false,
            request_timeout_ms: 60_000,
            body_limit_bytes: DEFAULT_BODY_LIMIT_MB * 1024 * 1024,
            signer_endpoints: vec![
                "http://localhost:5101".to_string(),
                "http://localhost:5102".to_string(),
                "http://localhost:5103".to_string(),
            ],
            mtls_ca_path: None,
            mtls_cert_path: None,
            mtls_key_path: None,
            jwks_url: None,
            signer_id: None,
            ciphersuite: Ciphersuite::Secp256k1,
            kek_provider: KekProvider::Local,
            kek_id: None,
        }
    }

    /// Create settings for signer tests.
    pub fn for_signer_tests(id: &str, port: u16) -> Self {
        Self {
            role: Role::Signer,
            port,
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            db_path: PathBuf::from(format!("./.data/test-{id}.redb")),
            internal_token: None,
            internal_token_required: false,
            request_timeout_ms: 60_000,
            body_limit_bytes: DEFAULT_BODY_LIMIT_MB * 1024 * 1024,
            signer_endpoints: vec![],
            mtls_ca_path: None,
            mtls_cert_path: None,
            mtls_key_path: None,
            jwks_url: None,
            signer_id: Some(id.to_string()),
            ciphersuite: Ciphersuite::Secp256k1,
            kek_provider: KekProvider::Local,
            kek_id: None,
        }
    }

    /// Validate settings for the configured role.
    ///
    /// Returns an error message if validation fails.
    pub fn validate(&self) -> Result<(), String> {
        // Common validation
        if self.internal_token_required && self.internal_token.is_none() {
            return Err("INTERNAL_SERVICE_TOKEN is required in production. \
                 Set INTERNAL_SERVICE_TOKEN or INTERNAL_SERVICE_TOKEN_REQUIRED=0."
                .to_string());
        }

        match self.role {
            Role::Coordinator => self.validate_coordinator(),
            Role::Signer => self.validate_signer(),
        }
    }

    fn validate_coordinator(&self) -> Result<(), String> {
        if self.signer_endpoints.is_empty() {
            return Err("SIGNER_ENDPOINTS is required for coordinator role. \
                 Provide comma-separated list of signer URLs."
                .to_string());
        }

        // mTLS validation: if any mTLS path is set, all must be set
        let mtls_paths = [
            &self.mtls_ca_path,
            &self.mtls_cert_path,
            &self.mtls_key_path,
        ];
        let mtls_count = mtls_paths.iter().filter(|p| p.is_some()).count();
        if mtls_count > 0 && mtls_count < 3 {
            return Err("Incomplete mTLS configuration. Set all of: \
                 SIGNER_MTLS_CA_PATH, SIGNER_MTLS_CERT_PATH, SIGNER_MTLS_KEY_PATH"
                .to_string());
        }

        Ok(())
    }

    fn validate_signer(&self) -> Result<(), String> {
        if self.signer_id.is_none() {
            return Err("SIGNER_ID is required for signer role. \
                 Provide a unique identifier for this signer instance."
                .to_string());
        }

        Ok(())
    }

    // Getters

    pub fn role(&self) -> Role {
        self.role
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn socket_addr(&self) -> SocketAddr {
        SocketAddr::new(self.host, self.port)
    }

    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    pub fn internal_token(&self) -> Option<&str> {
        self.internal_token.as_deref()
    }

    pub fn internal_token_required(&self) -> bool {
        self.internal_token_required
    }

    pub fn request_timeout(&self) -> Duration {
        Duration::from_millis(self.request_timeout_ms)
    }

    pub fn body_limit_bytes(&self) -> usize {
        self.body_limit_bytes
    }

    pub fn signer_endpoints(&self) -> &[String] {
        &self.signer_endpoints
    }

    pub fn mtls_ca_path(&self) -> Option<&PathBuf> {
        self.mtls_ca_path.as_ref()
    }

    pub fn mtls_cert_path(&self) -> Option<&PathBuf> {
        self.mtls_cert_path.as_ref()
    }

    pub fn mtls_key_path(&self) -> Option<&PathBuf> {
        self.mtls_key_path.as_ref()
    }

    pub fn jwks_url(&self) -> Option<&str> {
        self.jwks_url.as_deref()
    }

    pub fn signer_id(&self) -> Option<&str> {
        self.signer_id.as_deref()
    }

    pub fn ciphersuite(&self) -> Ciphersuite {
        self.ciphersuite
    }

    pub fn kek_provider(&self) -> &KekProvider {
        &self.kek_provider
    }

    pub fn kek_id(&self) -> Option<&str> {
        self.kek_id.as_deref()
    }

    /// Check if mTLS is configured.
    pub fn mtls_enabled(&self) -> bool {
        self.mtls_ca_path.is_some() && self.mtls_cert_path.is_some() && self.mtls_key_path.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_parsing() {
        assert_eq!("coordinator".parse::<Role>().unwrap(), Role::Coordinator);
        assert_eq!("signer".parse::<Role>().unwrap(), Role::Signer);
        assert_eq!("COORDINATOR".parse::<Role>().unwrap(), Role::Coordinator);
        assert!("invalid".parse::<Role>().is_err());
    }

    #[test]
    fn test_ciphersuite_parsing() {
        assert_eq!(
            "secp256k1".parse::<Ciphersuite>().unwrap(),
            Ciphersuite::Secp256k1
        );
        assert_eq!(
            "ed25519".parse::<Ciphersuite>().unwrap(),
            Ciphersuite::Ed25519
        );
        assert!("invalid".parse::<Ciphersuite>().is_err());
    }

    #[test]
    fn test_coordinator_settings_validation() {
        let settings = Settings::for_coordinator_tests();
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn test_signer_settings_validation() {
        let settings = Settings::for_signer_tests("signer-1", 5101);
        assert!(settings.validate().is_ok());
    }
}

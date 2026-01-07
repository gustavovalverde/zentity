//! TLS configuration for mTLS between coordinator and signers.
//!
//! Provides functions to load PEM certificates and build rustls configurations
//! for both server (signer) and client (coordinator) roles.
//!
//! ## Usage
//!
//! **Server (Signer)**:
//! ```ignore
//! let config = load_server_config(ca_path, cert_path, key_path)?;
//! server.bind_rustls_0_23(addr, config)?.run().await
//! ```
//!
//! **Client (Coordinator)**:
//! ```ignore
//! let config = load_client_config(ca_path, cert_path, key_path)?;
//! Client::builder().use_preconfigured_tls(config).build()
//! ```

use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::WebPkiClientVerifier;
use rustls::{ClientConfig, RootCertStore, ServerConfig};

use crate::error::{SignerError, SignerResult};

/// Load certificates from a PEM file.
fn load_certs(path: &Path) -> SignerResult<Vec<CertificateDer<'static>>> {
    let file = File::open(path).map_err(|e| {
        SignerError::TlsConfig(format!(
            "Failed to open certificate file {}: {e}",
            path.display()
        ))
    })?;
    let mut reader = BufReader::new(file);

    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            SignerError::TlsConfig(format!(
                "Failed to parse certificates from {}: {e}",
                path.display()
            ))
        })?;

    if certs.is_empty() {
        return Err(SignerError::TlsConfig(format!(
            "No certificates found in {}",
            path.display()
        )));
    }

    Ok(certs)
}

/// Load a private key from a PEM file.
///
/// Supports PKCS#8, RSA, and EC private keys.
fn load_private_key(path: &Path) -> SignerResult<PrivateKeyDer<'static>> {
    let file = File::open(path).map_err(|e| {
        SignerError::TlsConfig(format!("Failed to open key file {}: {e}", path.display()))
    })?;
    let mut reader = BufReader::new(file);

    // Try to read any type of private key
    let key = rustls_pemfile::private_key(&mut reader)
        .map_err(|e| {
            SignerError::TlsConfig(format!(
                "Failed to parse private key from {}: {e}",
                path.display()
            ))
        })?
        .ok_or_else(|| {
            SignerError::TlsConfig(format!("No private key found in {}", path.display()))
        })?;

    Ok(key)
}

/// Build a root certificate store from CA certificates.
fn build_root_store(ca_certs: Vec<CertificateDer<'static>>) -> SignerResult<RootCertStore> {
    let mut root_store = RootCertStore::empty();

    for cert in ca_certs {
        root_store.add(cert).map_err(|e| {
            SignerError::TlsConfig(format!("Failed to add CA certificate to root store: {e}"))
        })?;
    }

    Ok(root_store)
}

/// Load server TLS configuration for the signer service.
///
/// Configures mTLS with client certificate verification. Only clients
/// presenting certificates signed by the CA will be accepted.
///
/// # Arguments
///
/// * `ca_path` - Path to CA certificate PEM file (for verifying clients)
/// * `cert_path` - Path to server certificate PEM file
/// * `key_path` - Path to server private key PEM file
///
/// # Returns
///
/// A `ServerConfig` ready for use with `actix-web::HttpServer::bind_rustls_0_23()`.
pub fn load_server_config(
    ca_path: &Path,
    cert_path: &Path,
    key_path: &Path,
) -> SignerResult<ServerConfig> {
    // Load CA certificates for client verification
    let ca_certs = load_certs(ca_path)?;
    let root_store = build_root_store(ca_certs)?;

    // Load server certificate chain
    let cert_chain = load_certs(cert_path)?;

    // Load server private key
    let private_key = load_private_key(key_path)?;

    // Build client verifier (requires client certificates)
    let client_verifier = WebPkiClientVerifier::builder(Arc::new(root_store))
        .build()
        .map_err(|e| SignerError::TlsConfig(format!("Failed to build client verifier: {e}")))?;

    // Build server config
    let config = ServerConfig::builder()
        .with_client_cert_verifier(client_verifier)
        .with_single_cert(cert_chain, private_key)
        .map_err(|e| SignerError::TlsConfig(format!("Failed to build server config: {e}")))?;

    tracing::info!(
        ca = %ca_path.display(),
        cert = %cert_path.display(),
        "Loaded mTLS server configuration"
    );

    Ok(config)
}

/// Load client TLS configuration for the coordinator.
///
/// Configures mTLS with client certificate authentication. The coordinator
/// will present its certificate when connecting to signers.
///
/// # Arguments
///
/// * `ca_path` - Path to CA certificate PEM file (for verifying servers)
/// * `cert_path` - Path to client certificate PEM file
/// * `key_path` - Path to client private key PEM file
///
/// # Returns
///
/// A `ClientConfig` ready for use with `reqwest::Client::builder().use_preconfigured_tls()`.
pub fn load_client_config(
    ca_path: &Path,
    cert_path: &Path,
    key_path: &Path,
) -> SignerResult<ClientConfig> {
    // Load CA certificates for server verification
    let ca_certs = load_certs(ca_path)?;
    let root_store = build_root_store(ca_certs)?;

    // Load client certificate chain
    let cert_chain = load_certs(cert_path)?;

    // Load client private key
    let private_key = load_private_key(key_path)?;

    // Build client config with client authentication
    let config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_client_auth_cert(cert_chain, private_key)
        .map_err(|e| SignerError::TlsConfig(format!("Failed to build client config: {e}")))?;

    tracing::info!(
        ca = %ca_path.display(),
        cert = %cert_path.display(),
        "Loaded mTLS client configuration"
    );

    Ok(config)
}

/// Check if PEM file permissions are secure (not world-readable).
///
/// Logs a warning if the file is readable by others, which could
/// expose private keys.
#[cfg(unix)]
pub fn check_key_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = std::fs::metadata(path) {
        let mode = metadata.permissions().mode();
        // Check if group or others have read permission
        if mode & 0o044 != 0 {
            tracing::warn!(
                path = %path.display(),
                mode = format!("{mode:o}"),
                "Private key file has overly permissive permissions. \
                 Consider running: chmod 600 {}",
                path.display()
            );
        }
    }
}

#[cfg(not(unix))]
pub fn check_key_permissions(_path: &Path) {
    // No-op on non-Unix systems
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::{
        BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer,
        KeyPair, KeyUsagePurpose,
    };
    use tempfile::TempDir;

    /// Generate test certificates for mTLS testing.
    fn generate_test_certs(
        temp_dir: &TempDir,
    ) -> (
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
    ) {
        // Generate CA key pair
        let ca_key_pair = KeyPair::generate().expect("CA key generation failed");

        // Generate CA certificate params
        let mut ca_params = CertificateParams::default();
        ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        ca_params
            .distinguished_name
            .push(DnType::CommonName, "Test CA");
        ca_params.key_usages.push(KeyUsagePurpose::KeyCertSign);

        // Self-sign the CA certificate
        let ca_cert = ca_params
            .self_signed(&ca_key_pair)
            .expect("CA generation failed");

        // Create issuer from CA params and key (rcgen 0.14 API)
        let ca_issuer = Issuer::from_params(&ca_params, &ca_key_pair);

        // Generate server key pair
        let server_key_pair = KeyPair::generate().expect("Server key generation failed");

        // Generate server cert params
        let mut server_params = CertificateParams::default();
        server_params
            .distinguished_name
            .push(DnType::CommonName, "signer");
        server_params
            .key_usages
            .push(KeyUsagePurpose::DigitalSignature);
        server_params
            .extended_key_usages
            .push(ExtendedKeyUsagePurpose::ServerAuth);
        let server_cert = server_params
            .signed_by(&server_key_pair, &ca_issuer)
            .expect("Server cert generation failed");

        // Generate client key pair
        let client_key_pair = KeyPair::generate().expect("Client key generation failed");

        // Generate client cert params
        let mut client_params = CertificateParams::default();
        client_params
            .distinguished_name
            .push(DnType::CommonName, "coordinator");
        client_params
            .key_usages
            .push(KeyUsagePurpose::DigitalSignature);
        client_params
            .extended_key_usages
            .push(ExtendedKeyUsagePurpose::ClientAuth);
        let client_cert = client_params
            .signed_by(&client_key_pair, &ca_issuer)
            .expect("Client cert generation failed");

        // Write to temp files
        let ca_path = temp_dir.path().join("ca.pem");
        let server_cert_path = temp_dir.path().join("server.pem");
        let server_key_path = temp_dir.path().join("server.key");
        let client_cert_path = temp_dir.path().join("client.pem");
        let client_key_path = temp_dir.path().join("client.key");

        std::fs::write(&ca_path, ca_cert.pem()).expect("Write CA failed");
        std::fs::write(&server_cert_path, server_cert.pem()).expect("Write server cert failed");
        std::fs::write(&server_key_path, server_key_pair.serialize_pem())
            .expect("Write server key failed");
        std::fs::write(&client_cert_path, client_cert.pem()).expect("Write client cert failed");
        std::fs::write(&client_key_path, client_key_pair.serialize_pem())
            .expect("Write client key failed");

        (
            ca_path,
            server_cert_path,
            server_key_path,
            client_cert_path,
            client_key_path,
        )
    }

    #[test]
    fn test_load_server_config() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let (ca_path, server_cert_path, server_key_path, _, _) = generate_test_certs(&temp_dir);

        let config = load_server_config(&ca_path, &server_cert_path, &server_key_path);
        assert!(config.is_ok(), "Failed to load server config: {config:?}");
    }

    #[test]
    fn test_load_client_config() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let (ca_path, _, _, client_cert_path, client_key_path) = generate_test_certs(&temp_dir);

        let config = load_client_config(&ca_path, &client_cert_path, &client_key_path);
        assert!(config.is_ok(), "Failed to load client config: {config:?}");
    }

    #[test]
    fn test_load_missing_file() {
        let result = load_certs(Path::new("/nonexistent/path.pem"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Failed to open"));
    }

    #[test]
    fn test_load_empty_cert_file() {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let empty_path = temp_dir.path().join("empty.pem");
        std::fs::write(&empty_path, "").expect("Write failed");

        let result = load_certs(&empty_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No certificates"));
    }
}

//! FROST Signer Service
//!
//! Holds exactly one key share and produces partial signatures.
//! Isolated instance - cannot access other signers' shares.
//!
//! ## Responsibilities
//!
//! - Store encrypted key share in envelope encryption
//! - Participate in DKG (receive encrypted round-2 shares)
//! - Produce partial signatures when authorized
//!
//! ## Security
//!
//! - Only accessible via mTLS from the coordinator
//! - Key share decryption happens only in memory
//! - Validates guardian assertions before signing

use actix_web::{App, HttpServer, middleware, web};
use signer_service::{
    config::{Role, Settings},
    frost::SignerService,
    routes,
    storage::Storage,
    telemetry, tls,
};
use tracing_actix_web::TracingLogger;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing first
    telemetry::init_tracing();

    // Load and validate settings
    let settings = Settings::from_env();

    // Verify we're running as signer
    if settings.role() != Role::Signer {
        tracing::error!(
            role = %settings.role(),
            "This binary must be run with SIGNER_ROLE=signer"
        );
        std::process::exit(1);
    }

    if let Err(message) = settings.validate() {
        tracing::error!("{message}");
        std::process::exit(1);
    }

    // Initialize storage
    let storage = match Storage::open(settings.db_path()) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "Failed to open storage database");
            std::process::exit(1);
        }
    };

    let addr = settings.socket_addr();
    let signer_id = settings
        .signer_id()
        .map_or_else(|| "unknown".to_string(), String::from);

    // Parse participant ID from signer_id (e.g., "signer-1" -> 1)
    let participant_id = signer_service::frost::types::ParticipantId::new(
        signer_id
            .split('-')
            .next_back()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1),
    )
    .expect("Participant ID cannot be 0");

    let ciphersuite = settings.ciphersuite();
    let jwt_verification_enabled = settings.jwks_url().is_some();

    // Create signer service (with or without JWT verification)
    #[allow(clippy::option_if_let_else)] // Clearer with explicit branches for logging
    let signer_service = if let Some(jwks_url) = settings.jwks_url() {
        tracing::info!(jwks_url = %jwks_url, "JWT verification enabled for guardian assertions");
        SignerService::with_jwt_verification(
            storage.clone(),
            signer_id.clone(),
            participant_id,
            ciphersuite,
            jwks_url.to_string(),
        )
    } else {
        tracing::warn!(
            "JWT verification DISABLED for guardian assertions. \
             Set GUARDIAN_ASSERTION_JWKS_URL for production."
        );
        SignerService::new(
            storage.clone(),
            signer_id.clone(),
            participant_id,
            ciphersuite,
        )
    };

    tracing::info!(
        addr = %addr,
        signer_id = %signer_id,
        participant_id = %participant_id,
        ciphersuite = %ciphersuite,
        kek_provider = ?settings.kek_provider(),
        jwt_verification = jwt_verification_enabled,
        hpke_pubkey = %signer_service.hpke_pubkey_base64(),
        "Starting FROST Signer"
    );

    // Clone settings for app_data
    let settings_data = web::Data::new(settings.clone());
    let storage_data = web::Data::new(storage);
    let signer_service_data = web::Data::new(signer_service);

    // Build the HTTP server
    let server = HttpServer::new(move || {
        App::new()
            // Request tracing
            .wrap(TracingLogger::default())
            // Default headers
            .wrap(
                middleware::DefaultHeaders::new()
                    .add(("X-Service", "frost-signer"))
                    .add(("X-Signer-Id", signer_id.clone())),
            )
            // Shared state
            .app_data(settings_data.clone())
            .app_data(storage_data.clone())
            .app_data(signer_service_data.clone())
            // Routes
            .configure(routes::health::configure)
            .configure(routes::signer_routes::configure)
    });

    // Bind with mTLS if configured, otherwise plain HTTP (development only)
    if settings.mtls_enabled() {
        let ca_path = settings.mtls_ca_path().expect("mTLS CA path required");
        let cert_path = settings.mtls_cert_path().expect("mTLS cert path required");
        let key_path = settings.mtls_key_path().expect("mTLS key path required");

        // Check key file permissions
        tls::check_key_permissions(key_path);

        let tls_config = tls::load_server_config(ca_path, cert_path, key_path)
            .map_err(|e| std::io::Error::other(e.to_string()))?;

        tracing::info!("Starting signer with mTLS enabled");
        server.bind_rustls_0_23(addr, tls_config)?.run().await?;
    } else {
        tracing::warn!(
            "Starting signer WITHOUT mTLS - development mode only! \
             Set SIGNER_MTLS_CA_PATH, SIGNER_MTLS_CERT_PATH, SIGNER_MTLS_KEY_PATH for production."
        );
        server.bind(addr)?.run().await?;
    }

    // Shutdown tracing
    telemetry::shutdown_tracing();

    Ok(())
}

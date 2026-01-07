//! FROST Coordinator Service
//!
//! Orchestrates DKG and signing sessions across isolated signers.
//! Never sees plaintext key shares.
//!
//! ## Responsibilities
//!
//! - Validate incoming requests from the web app
//! - Route DKG round-2 shares to the correct signer
//! - Collect and validate partial signatures
//! - Aggregate partial signatures into final FROST signature
//!
//! ## Security
//!
//! - Authenticates web app via `INTERNAL_SERVICE_TOKEN`
//! - Communicates with signers over mTLS
//! - Never stores or decrypts key shares
//! - Rate limits all endpoints to prevent abuse

use actix_web::{App, HttpServer, middleware, web};
use signer_service::{
    config::{Role, Settings},
    frost::Coordinator,
    middleware::{RateLimitConfig, general_limiter},
    routes,
    storage::Storage,
    telemetry,
};
use tracing_actix_web::TracingLogger;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing first
    telemetry::init_tracing();

    // Load and validate settings
    let settings = Settings::from_env();

    // Verify we're running as coordinator
    if settings.role() != Role::Coordinator {
        tracing::error!(
            role = %settings.role(),
            "This binary must be run with SIGNER_ROLE=coordinator"
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

    // Create coordinator service
    let coordinator = match Coordinator::new(storage.clone(), &settings) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "Failed to create coordinator");
            std::process::exit(1);
        }
    };

    let addr = settings.socket_addr();
    let signer_count = settings.signer_endpoints().len();

    // Load rate limit configuration from environment
    let rate_config = RateLimitConfig::from_env();
    tracing::info!(
        dkg_init_per_hour = rate_config.dkg_init_per_hour,
        dkg_round_per_hour = rate_config.dkg_round_per_hour,
        signing_per_hour = rate_config.signing_per_hour,
        "Rate limiting enabled"
    );

    tracing::info!(
        addr = %addr,
        signers = signer_count,
        mtls_enabled = settings.mtls_enabled(),
        "Starting FROST Coordinator"
    );

    // Clone settings for app_data
    let settings_data = web::Data::new(settings.clone());
    let storage_data = web::Data::new(storage);
    let coordinator_data = web::Data::new(coordinator);

    HttpServer::new(move || {
        App::new()
            // Rate limiting (applied first)
            .wrap(general_limiter())
            // Request tracing
            .wrap(TracingLogger::default())
            // Default headers
            .wrap(middleware::DefaultHeaders::new().add(("X-Service", "frost-coordinator")))
            // Shared state
            .app_data(settings_data.clone())
            .app_data(storage_data.clone())
            .app_data(coordinator_data.clone())
            // Routes
            .configure(routes::health::configure)
            .configure(routes::dkg::configure)
            .configure(routes::signing::configure)
    })
    .bind(addr)?
    .run()
    .await?;

    // Shutdown tracing
    telemetry::shutdown_tracing();

    Ok(())
}

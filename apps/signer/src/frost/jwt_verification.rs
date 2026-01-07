//! JWT verification for guardian assertions.
//!
//! Guardian assertions are JWTs that authorize a participant to sign.
//! They contain claims binding the guardian to a specific session and participant.
//!
//! ## Security Properties
//!
//! - Tokens are verified against a JWKS endpoint (Better Auth)
//! - Claims are validated for session binding (session_id, participant_id)
//! - Expiration is enforced (48-hour window per RFC-0014)
//! - Scope must be "frost:sign"

use std::sync::Arc;
use std::time::{Duration, Instant};

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::error::{SignerError, SignerResult};
use crate::frost::types::ParticipantId;

/// Guardian type classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GuardianType {
    /// Email-based guardian (receives recovery link)
    Email,
    /// Device-based guardian (passkey on trusted device)
    Device,
    /// Wallet-based guardian (signs with external wallet)
    Wallet,
    /// On-chain guardian (smart contract guardian)
    Onchain,
}

/// Claims contained in a guardian assertion JWT.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardianAssertionClaims {
    /// Issuer (Better Auth service URL)
    pub iss: String,
    /// Subject (user being recovered)
    pub sub: String,
    /// Expiration timestamp (Unix seconds)
    pub exp: u64,
    /// Issued at timestamp (Unix seconds)
    pub iat: u64,
    /// Guardian UUID
    pub guardian_id: String,
    /// Guardian type
    pub guardian_type: GuardianType,
    /// FROST participant index
    pub participant_id: u16,
    /// Signing session UUID
    pub session_id: String,
    /// Recovery challenge UUID
    pub challenge_id: String,
    /// Authorization scope (must be "frost:sign")
    pub scope: String,
}

/// JWKS (JSON Web Key Set) response from the auth service.
#[derive(Debug, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

/// A single JWK (JSON Web Key).
#[derive(Debug, Clone, Deserialize)]
struct JwkKey {
    /// Key ID
    kid: String,
    /// Key type (e.g., "RSA", "EC")
    kty: String,
    /// Algorithm (e.g., "RS256", "ES256") - parsed for future use
    #[allow(dead_code)]
    alg: Option<String>,
    /// RSA modulus (for RSA keys)
    n: Option<String>,
    /// RSA exponent (for RSA keys)
    e: Option<String>,
    /// EC curve (for EC keys) - parsed for future use
    #[allow(dead_code)]
    crv: Option<String>,
    /// EC x coordinate (for EC keys)
    x: Option<String>,
    /// EC y coordinate (for EC keys)
    y: Option<String>,
}

/// Cached JWKS with TTL tracking.
struct CachedJwks {
    keys: Vec<JwkKey>,
    fetched_at: Instant,
}

/// Default JWKS cache TTL (5 minutes).
const JWKS_CACHE_TTL: Duration = Duration::from_secs(300);

/// Maximum token age (48 hours per RFC-0014).
const MAX_TOKEN_AGE_SECS: u64 = 48 * 60 * 60;

/// JWT verifier with JWKS caching.
pub struct JwtVerifier {
    jwks_url: String,
    http_client: reqwest::Client,
    cache: Arc<RwLock<Option<CachedJwks>>>,
    /// Override for testing (allows skipping JWKS fetch)
    #[cfg(test)]
    #[allow(dead_code)]
    test_decoding_key: Option<DecodingKey>,
}

impl JwtVerifier {
    /// Create a new JWT verifier.
    ///
    /// # Arguments
    ///
    /// * `jwks_url` - URL of the JWKS endpoint (e.g., "https://auth.zentity.xyz/.well-known/jwks.json")
    pub fn new(jwks_url: String) -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client for JWKS");

        Self {
            jwks_url,
            http_client,
            cache: Arc::new(RwLock::new(None)),
            #[cfg(test)]
            test_decoding_key: None,
        }
    }

    /// Verify a guardian assertion JWT.
    ///
    /// # Arguments
    ///
    /// * `token` - The JWT token string
    /// * `session_id` - Expected session ID
    /// * `participant_id` - Expected participant ID
    ///
    /// # Returns
    ///
    /// The validated claims if verification succeeds.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Token signature is invalid
    /// - Token is expired
    /// - Session ID doesn't match
    /// - Participant ID doesn't match
    /// - Scope is not "frost:sign"
    pub async fn verify(
        &self,
        token: &str,
        session_id: &str,
        participant_id: ParticipantId,
    ) -> SignerResult<GuardianAssertionClaims> {
        // Decode header to get key ID
        let header = decode_header(token)?;
        let kid = header.kid.ok_or_else(|| {
            SignerError::InvalidGuardianAssertion("Missing key ID in JWT header".to_string())
        })?;

        // Get decoding key
        let decoding_key = self.get_decoding_key(&kid, header.alg).await?;

        // Set up validation
        let mut validation = Validation::new(header.alg);
        validation.set_required_spec_claims(&["exp", "iat", "iss", "sub"]);

        // Decode and validate token
        let token_data = decode::<GuardianAssertionClaims>(token, &decoding_key, &validation)?;
        let claims = token_data.claims;

        // Validate session binding
        if claims.session_id != session_id {
            return Err(SignerError::InvalidGuardianAssertion(format!(
                "Session ID mismatch: expected {session_id}, got {}",
                claims.session_id
            )));
        }

        // Validate participant binding
        if claims.participant_id != participant_id {
            return Err(SignerError::InvalidGuardianAssertion(format!(
                "Participant ID mismatch: expected {participant_id}, got {}",
                claims.participant_id
            )));
        }

        // Validate scope
        if claims.scope != "frost:sign" {
            return Err(SignerError::InvalidGuardianAssertion(format!(
                "Invalid scope: expected 'frost:sign', got '{}'",
                claims.scope
            )));
        }

        // Validate token age (48-hour window)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if now > claims.iat + MAX_TOKEN_AGE_SECS {
            return Err(SignerError::GuardianAssertionExpired);
        }

        tracing::debug!(
            guardian_id = %claims.guardian_id,
            guardian_type = ?claims.guardian_type,
            session_id = %claims.session_id,
            participant_id = claims.participant_id,
            "Guardian assertion verified"
        );

        Ok(claims)
    }

    /// Get a decoding key for the specified key ID.
    async fn get_decoding_key(&self, kid: &str, alg: Algorithm) -> SignerResult<DecodingKey> {
        // Check cache first
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.as_ref()
                && cached.fetched_at.elapsed() < JWKS_CACHE_TTL
                && let Some(key) = Self::find_key(&cached.keys, kid, alg)?
            {
                return Ok(key);
            }
        }

        // Fetch JWKS
        let jwks = self.fetch_jwks().await?;

        // Update cache
        {
            let mut cache = self.cache.write().await;
            *cache = Some(CachedJwks {
                keys: jwks.keys.clone(),
                fetched_at: Instant::now(),
            });
        }

        // Find key
        Self::find_key(&jwks.keys, kid, alg)?
            .ok_or_else(|| SignerError::InvalidGuardianAssertion(format!("Key not found: {kid}")))
    }

    /// Fetch JWKS from the auth service.
    async fn fetch_jwks(&self) -> SignerResult<JwksResponse> {
        let response = self
            .http_client
            .get(&self.jwks_url)
            .send()
            .await
            .map_err(|e| {
                SignerError::Internal(format!("Failed to fetch JWKS from {}: {e}", self.jwks_url))
            })?;

        if !response.status().is_success() {
            return Err(SignerError::Internal(format!(
                "JWKS endpoint returned {}: {}",
                response.status(),
                self.jwks_url
            )));
        }

        response
            .json()
            .await
            .map_err(|e| SignerError::Internal(format!("Failed to parse JWKS response: {e}")))
    }

    /// Find a decoding key in the JWKS by key ID.
    fn find_key(keys: &[JwkKey], kid: &str, alg: Algorithm) -> SignerResult<Option<DecodingKey>> {
        for key in keys {
            if key.kid != kid {
                continue;
            }

            let decoding_key = match (key.kty.as_str(), &alg) {
                // RSA keys
                ("RSA", Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512) => {
                    let n = key.n.as_ref().ok_or_else(|| {
                        SignerError::InvalidGuardianAssertion(
                            "RSA key missing 'n' component".to_string(),
                        )
                    })?;
                    let e = key.e.as_ref().ok_or_else(|| {
                        SignerError::InvalidGuardianAssertion(
                            "RSA key missing 'e' component".to_string(),
                        )
                    })?;
                    DecodingKey::from_rsa_components(n, e).map_err(|e| {
                        SignerError::InvalidGuardianAssertion(format!("Invalid RSA key: {e}"))
                    })?
                }
                // EC keys
                ("EC", Algorithm::ES256 | Algorithm::ES384) => {
                    let x = key.x.as_ref().ok_or_else(|| {
                        SignerError::InvalidGuardianAssertion(
                            "EC key missing 'x' component".to_string(),
                        )
                    })?;
                    let y = key.y.as_ref().ok_or_else(|| {
                        SignerError::InvalidGuardianAssertion(
                            "EC key missing 'y' component".to_string(),
                        )
                    })?;
                    DecodingKey::from_ec_components(x, y).map_err(|e| {
                        SignerError::InvalidGuardianAssertion(format!("Invalid EC key: {e}"))
                    })?
                }
                _ => {
                    continue; // Skip unsupported key types
                }
            };

            return Ok(Some(decoding_key));
        }

        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_guardian_type_deserialize() {
        let json = r#""email""#;
        let guardian_type: GuardianType = serde_json::from_str(json).unwrap();
        assert_eq!(guardian_type, GuardianType::Email);

        let json = r#""device""#;
        let guardian_type: GuardianType = serde_json::from_str(json).unwrap();
        assert_eq!(guardian_type, GuardianType::Device);
    }

    #[test]
    fn test_claims_deserialize() {
        let json = r#"{
            "iss": "https://auth.zentity.xyz",
            "sub": "user-123",
            "exp": 1700000000,
            "iat": 1699900000,
            "guardian_id": "guardian-456",
            "guardian_type": "email",
            "participant_id": 1,
            "session_id": "session-789",
            "challenge_id": "challenge-abc",
            "scope": "frost:sign"
        }"#;

        let claims: GuardianAssertionClaims = serde_json::from_str(json).unwrap();
        assert_eq!(claims.iss, "https://auth.zentity.xyz");
        assert_eq!(claims.guardian_type, GuardianType::Email);
        assert_eq!(claims.participant_id, 1);
        assert_eq!(claims.scope, "frost:sign");
    }
}

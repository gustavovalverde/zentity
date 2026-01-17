//! HPKE encryption for DKG round-2 shares.
//!
//! Uses X25519-HKDF-SHA256 with ChaCha20Poly1305 for encrypting round-2
//! secret shares to their intended recipients.
//!
//! Security: Round-2 shares contain secret key material that must only
//! be readable by the intended recipient signer.

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use hpke::{
    Deserializable, Kem, OpModeR, OpModeS, Serializable, aead::ChaCha20Poly1305, kdf::HkdfSha256,
    kem::X25519HkdfSha256, single_shot_open, single_shot_seal,
};
// Use hpke's re-exported rand_core (0.9.3) for HPKE operations
use hpke::rand_core::OsRng;
use zeroize::Zeroize;

use crate::error::{SignerError, SignerResult};

/// HPKE public key (X25519).
pub type HpkePublicKey = <X25519HkdfSha256 as Kem>::PublicKey;

/// HPKE secret key (X25519).
pub type HpkeSecretKey = <X25519HkdfSha256 as Kem>::PrivateKey;

/// HPKE encapsulated key.
pub type HpkeEncappedKey = <X25519HkdfSha256 as Kem>::EncappedKey;

/// HPKE key pair for a signer.
pub struct HpkeKeyPair {
    pub public_key: HpkePublicKey,
    secret_key: HpkeSecretKey,
}

impl HpkeKeyPair {
    /// Generate a new random key pair.
    pub fn generate() -> Self {
        let (secret_key, public_key) = X25519HkdfSha256::gen_keypair(&mut OsRng);
        Self {
            public_key,
            secret_key,
        }
    }

    /// Create from an existing secret key.
    pub fn from_secret_key(secret_key: HpkeSecretKey) -> Self {
        let public_key = X25519HkdfSha256::sk_to_pk(&secret_key);
        Self {
            public_key,
            secret_key,
        }
    }

    /// Get the secret key (use carefully).
    pub fn secret_key(&self) -> &HpkeSecretKey {
        &self.secret_key
    }

    /// Serialize the public key to base64.
    pub fn public_key_base64(&self) -> String {
        BASE64.encode(self.public_key.to_bytes())
    }

    /// Serialize the secret key to base64 (for storage).
    pub fn secret_key_base64(&self) -> String {
        BASE64.encode(self.secret_key.to_bytes())
    }

    /// Deserialize a public key from base64.
    pub fn public_key_from_base64(encoded: &str) -> SignerResult<HpkePublicKey> {
        let bytes = BASE64
            .decode(encoded)
            .map_err(|e| SignerError::HpkeDecryptionFailed(format!("Invalid base64: {e}")))?;

        HpkePublicKey::from_bytes(&bytes)
            .map_err(|e| SignerError::HpkeDecryptionFailed(format!("Invalid public key: {e}")))
    }

    /// Deserialize a secret key from base64.
    pub fn secret_key_from_base64(encoded: &str) -> SignerResult<HpkeSecretKey> {
        let bytes = BASE64
            .decode(encoded)
            .map_err(|e| SignerError::HpkeDecryptionFailed(format!("Invalid base64: {e}")))?;

        HpkeSecretKey::from_bytes(&bytes)
            .map_err(|e| SignerError::HpkeDecryptionFailed(format!("Invalid secret key: {e}")))
    }
}

impl Drop for HpkeKeyPair {
    #[allow(clippy::collection_is_never_read)]
    fn drop(&mut self) {
        // Best-effort zeroization: we export and zeroize a copy of the key bytes.
        // Note: This doesn't zeroize the hpke crate's internal storage, but provides
        // defense-in-depth by ensuring any exported copies don't linger in memory.
        let mut sk_bytes = self.secret_key.to_bytes().to_vec();
        sk_bytes.zeroize();
    }
}

/// Encrypted HPKE payload.
#[derive(Debug, Clone)]
pub struct EncryptedPayload {
    /// Encapsulated key (for recipient to derive shared secret).
    pub encapped_key: Vec<u8>,
    /// Ciphertext (authenticated encryption).
    pub ciphertext: Vec<u8>,
}

impl EncryptedPayload {
    /// Serialize to base64 string (encapped_key || ciphertext, length-prefixed).
    pub fn to_base64(&self) -> String {
        // Format: 4-byte length of encapped_key (big-endian) || encapped_key || ciphertext
        let mut bytes = Vec::with_capacity(4 + self.encapped_key.len() + self.ciphertext.len());
        // Safety: encapped_key is always 32 bytes (X25519), well within u32::MAX
        #[allow(clippy::cast_possible_truncation)]
        let len_bytes = (self.encapped_key.len() as u32).to_be_bytes();
        bytes.extend_from_slice(&len_bytes);
        bytes.extend_from_slice(&self.encapped_key);
        bytes.extend_from_slice(&self.ciphertext);
        BASE64.encode(&bytes)
    }

    /// Deserialize from base64 string.
    pub fn from_base64(encoded: &str) -> SignerResult<Self> {
        let bytes = BASE64.decode(encoded).map_err(|e| {
            SignerError::HpkeDecryptionFailed(format!("Invalid base64 payload: {e}"))
        })?;

        if bytes.len() < 4 {
            return Err(SignerError::HpkeDecryptionFailed(
                "Payload too short".to_string(),
            ));
        }

        let encapped_len = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;

        if bytes.len() < 4 + encapped_len {
            return Err(SignerError::HpkeDecryptionFailed(
                "Payload truncated".to_string(),
            ));
        }

        let encapped_key = bytes[4..4 + encapped_len].to_vec();
        let ciphertext = bytes[4 + encapped_len..].to_vec();

        Ok(Self {
            encapped_key,
            ciphertext,
        })
    }
}

/// Encrypt data to a recipient's HPKE public key.
///
/// Uses single-shot encryption with no additional authenticated data.
/// The `info` parameter binds the encryption to a specific context.
pub fn encrypt(
    recipient_pubkey: &HpkePublicKey,
    plaintext: &[u8],
    info: &[u8],
) -> SignerResult<EncryptedPayload> {
    let mode = OpModeS::Base;

    let (encapped_key, ciphertext) =
        single_shot_seal::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256, _>(
            &mode,
            recipient_pubkey,
            info,
            plaintext,
            &[], // empty AAD
            &mut OsRng,
        )
        .map_err(|e| SignerError::HpkeEncryptionFailed(format!("Seal failed: {e:?}")))?;

    Ok(EncryptedPayload {
        encapped_key: encapped_key.to_bytes().to_vec(),
        ciphertext,
    })
}

/// Decrypt data using the recipient's HPKE secret key.
pub fn decrypt(
    recipient_secret_key: &HpkeSecretKey,
    payload: &EncryptedPayload,
    info: &[u8],
) -> SignerResult<Vec<u8>> {
    let mode = OpModeR::Base;

    // Parse encapsulated key
    let encapped_key = HpkeEncappedKey::from_bytes(&payload.encapped_key)
        .map_err(|e| SignerError::HpkeDecryptionFailed(format!("Invalid encapped key: {e}")))?;

    single_shot_open::<ChaCha20Poly1305, HkdfSha256, X25519HkdfSha256>(
        &mode,
        recipient_secret_key,
        &encapped_key,
        info,
        &payload.ciphertext,
        &[], // empty AAD
    )
    .map_err(|e| SignerError::HpkeDecryptionFailed(format!("Open failed: {e:?}")))
}

/// Convenience: encrypt and return base64 string.
pub fn encrypt_to_base64(
    recipient_pubkey: &HpkePublicKey,
    plaintext: &[u8],
    info: &[u8],
) -> SignerResult<String> {
    let payload = encrypt(recipient_pubkey, plaintext, info)?;
    Ok(payload.to_base64())
}

/// Convenience: decrypt from base64 string.
pub fn decrypt_from_base64(
    recipient_secret_key: &HpkeSecretKey,
    encrypted_base64: &str,
    info: &[u8],
) -> SignerResult<Vec<u8>> {
    let payload = EncryptedPayload::from_base64(encrypted_base64)?;
    decrypt(recipient_secret_key, &payload, info)
}

/// Build HPKE info string for DKG round-2 encryption.
///
/// Format: "frost-dkg-round2|{session_id}|{from_id}|{to_id}|{commitment_hash}"
///
/// The commitment_hash binds the encryption to the specific round 1 commitment set,
/// preventing cross-session attacks per RFC 9591 §A.2.2.
pub fn dkg_round2_info(
    session_id: &uuid::Uuid,
    from_id: u16,
    to_id: u16,
    commitment_hash: Option<&[u8]>,
) -> Vec<u8> {
    commitment_hash.map_or_else(
        || format!("frost-dkg-round2|{session_id}|{from_id}|{to_id}").into_bytes(),
        |hash| {
            let hash_hex = hex::encode(hash);
            format!("frost-dkg-round2|{session_id}|{from_id}|{to_id}|{hash_hex}").into_bytes()
        },
    )
}

/// Compute a deterministic hash of round 1 packages for HPKE context binding.
///
/// Packages are sorted by participant ID and concatenated before hashing
/// to ensure all participants compute the same hash.
pub fn compute_commitment_hash(packages: &std::collections::BTreeMap<u16, &[u8]>) -> [u8; 32] {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    for (participant_id, package_bytes) in packages {
        hasher.update(participant_id.to_be_bytes());
        // Safety: FROST packages are small (< 1KB), truncation to u32 is safe
        #[allow(clippy::cast_possible_truncation)]
        let len = package_bytes.len() as u32;
        hasher.update(len.to_be_bytes());
        hasher.update(package_bytes);
    }
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_pair_generation() {
        let kp = HpkeKeyPair::generate();
        let pub_b64 = kp.public_key_base64();
        let sec_b64 = kp.secret_key_base64();

        // Can deserialize
        let pk = HpkeKeyPair::public_key_from_base64(&pub_b64).unwrap();
        let sk = HpkeKeyPair::secret_key_from_base64(&sec_b64).unwrap();

        // Public keys match
        assert_eq!(pk.to_bytes(), kp.public_key.to_bytes());
        assert_eq!(sk.to_bytes(), kp.secret_key.to_bytes());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let recipient = HpkeKeyPair::generate();
        let plaintext = b"secret DKG round-2 share data";
        let info = b"test-context";

        let encrypted = encrypt(&recipient.public_key, plaintext, info).unwrap();
        let decrypted = decrypt(recipient.secret_key(), &encrypted, info).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_base64_roundtrip() {
        let recipient = HpkeKeyPair::generate();
        let plaintext = b"another secret message";
        let info = b"another-context";

        let encrypted_b64 = encrypt_to_base64(&recipient.public_key, plaintext, info).unwrap();
        let decrypted = decrypt_from_base64(recipient.secret_key(), &encrypted_b64, info).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let sender_recipient = HpkeKeyPair::generate();
        let wrong_recipient = HpkeKeyPair::generate();
        let plaintext = b"secret";
        let info = b"context";

        let encrypted = encrypt(&sender_recipient.public_key, plaintext, info).unwrap();

        // Decryption with wrong key should fail
        let result = decrypt(wrong_recipient.secret_key(), &encrypted, info);
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_info_fails() {
        let recipient = HpkeKeyPair::generate();
        let plaintext = b"secret";

        let encrypted = encrypt(&recipient.public_key, plaintext, b"correct-info").unwrap();

        // Decryption with wrong info should fail
        let result = decrypt(recipient.secret_key(), &encrypted, b"wrong-info");
        assert!(result.is_err());
    }

    #[test]
    fn test_payload_serialization() {
        let payload = EncryptedPayload {
            encapped_key: vec![1, 2, 3, 4],
            ciphertext: vec![5, 6, 7, 8, 9],
        };

        let b64 = payload.to_base64();
        let restored = EncryptedPayload::from_base64(&b64).unwrap();

        assert_eq!(restored.encapped_key, payload.encapped_key);
        assert_eq!(restored.ciphertext, payload.ciphertext);
    }

    #[test]
    fn test_dkg_info_format_without_hash() {
        let session_id = uuid::Uuid::new_v4();
        let info = dkg_round2_info(&session_id, 1, 2, None);
        let info_str = String::from_utf8(info).unwrap();

        assert!(info_str.starts_with("frost-dkg-round2|"));
        assert!(info_str.contains("|1|2"));
    }

    #[test]
    fn test_dkg_info_format_with_hash() {
        let session_id = uuid::Uuid::new_v4();
        let commitment_hash = [0xab; 32];
        let info = dkg_round2_info(&session_id, 1, 2, Some(&commitment_hash));
        let info_str = String::from_utf8(info).unwrap();

        assert!(info_str.starts_with("frost-dkg-round2|"));
        assert!(info_str.contains("|1|2|"));
        assert!(info_str.ends_with(&hex::encode(commitment_hash)));
    }

    #[test]
    fn test_commitment_hash_deterministic() {
        let mut packages = std::collections::BTreeMap::new();
        packages.insert(1_u16, b"package1".as_slice());
        packages.insert(2_u16, b"package2".as_slice());

        let hash1 = compute_commitment_hash(&packages);
        let hash2 = compute_commitment_hash(&packages);

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_commitment_hash_order_independent() {
        // BTreeMap ensures deterministic ordering
        let mut packages1 = std::collections::BTreeMap::new();
        packages1.insert(1_u16, b"pkg1".as_slice());
        packages1.insert(2_u16, b"pkg2".as_slice());

        let mut packages2 = std::collections::BTreeMap::new();
        packages2.insert(2_u16, b"pkg2".as_slice());
        packages2.insert(1_u16, b"pkg1".as_slice());

        assert_eq!(
            compute_commitment_hash(&packages1),
            compute_commitment_hash(&packages2)
        );
    }
}

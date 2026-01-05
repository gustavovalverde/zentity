//! Test-only helpers that keep production modules lean.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::crypto::KeyStore;

pub mod keystore {
    use super::*;

    /// Create a new KeyStore with a specific keys directory for testing.
    /// This bypasses the global OnceCell, allowing isolated persistence tests.
    pub fn create_test_keystore(keys_dir: PathBuf) -> KeyStore {
        KeyStore::new_for_tests(keys_dir)
    }

    /// Create a KeyStore that loads from disk if available.
    pub fn create_test_keystore_with_load(keys_dir: PathBuf) -> KeyStore {
        KeyStore::load_for_tests(keys_dir)
    }

    /// Get the keystore file path for a directory.
    pub fn get_keystore_path(keys_dir: &Path) -> PathBuf {
        KeyStore::keystore_path_for_tests(keys_dir)
    }
}

/// Ensure tests use a writable keys directory and set `FHE_KEYS_DIR` when missing.
pub fn init_test_env() -> PathBuf {
    if let Ok(dir) = std::env::var("FHE_KEYS_DIR") {
        let path = PathBuf::from(dir);
        std::fs::create_dir_all(&path).expect("Failed to create FHE_KEYS_DIR for tests");
        return path;
    }

    static TEST_KEYS_DIR: OnceLock<PathBuf> = OnceLock::new();
    let path = TEST_KEYS_DIR.get_or_init(|| {
        let dir =
            std::env::temp_dir().join(format!("zentity-fhe-test-keys-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("Failed to create test keys directory");
        std::env::set_var("FHE_KEYS_DIR", &dir);
        dir
    });

    path.clone()
}

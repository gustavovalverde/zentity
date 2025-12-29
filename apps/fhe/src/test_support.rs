//! Test-only helpers that keep production modules lean.

use std::path::{Path, PathBuf};

use crate::crypto::KeyStore;

pub mod keystore {
    use super::*;

    /// Create a new KeyStore with a specific keys directory for testing.
    /// This bypasses the global OnceCell, allowing isolated persistence tests.
    pub fn create_test_keystore(keys_dir: Option<PathBuf>) -> KeyStore {
        KeyStore::new_for_tests(keys_dir)
    }

    /// Create a KeyStore that loads from disk if available.
    pub fn create_test_keystore_with_load(keys_dir: PathBuf) -> KeyStore {
        KeyStore::load_for_tests(keys_dir)
    }

    /// Check if a keystore file exists at the given path.
    pub fn keystore_file_exists(keys_dir: &Path) -> bool {
        KeyStore::keystore_path_for_tests(keys_dir).exists()
    }

    /// Get the keystore file path for a directory.
    pub fn get_keystore_path(keys_dir: &Path) -> PathBuf {
        KeyStore::keystore_path_for_tests(keys_dir)
    }
}

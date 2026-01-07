//! Storage layer for the signer service.
//!
//! Uses ReDB for embedded key-value storage with ACID transactions.
//! Each role (coordinator/signer) maintains its own database file.

pub mod redb;

pub use self::redb::Storage;

//! Build script for FHE service
//!
//! Embeds git SHA and build time at compile time for deployment verification.
//! Priority: CI env var → git command → "unknown"

use std::process::Command;
use std::time::SystemTime;

fn main() {
    // Tell Cargo to rerun if git HEAD changes (path relative to repo root)
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs/heads/");

    // Priority: CI env var → git command → "unknown"
    let git_sha = std::env::var("GIT_SHA")
        .ok()
        .or_else(|| {
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_else(|| "unknown".to_string());

    // Priority: CI env var → Unix timestamp
    let build_time = std::env::var("BUILD_TIME").unwrap_or_else(|_| {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| format!("{}", d.as_secs()))
            .unwrap_or_else(|_| "unknown".to_string())
    });

    println!("cargo:rustc-env=GIT_SHA={}", git_sha);
    println!("cargo:rustc-env=BUILD_TIME={}", build_time);
}

//! HTTP Route handlers

mod age;
mod batch;
mod compliance;
mod country;
mod health;
mod keys;
mod liveness;

use std::sync::{Arc, OnceLock};
use std::time::Instant;

use tokio::sync::Semaphore;
use tokio::task;

use crate::error::FheError;

pub use age::{encrypt_birth_year_offset, verify_age_offset};
pub use batch::encrypt_batch;
pub use compliance::encrypt_compliance_level;
pub use country::encrypt_country_code;
pub use health::{build_info, health};
pub use keys::{debug_keys, register_key};
pub use liveness::{encrypt_liveness, verify_liveness_threshold};

struct CpuLimiter {
    semaphore: Arc<Semaphore>,
    limit: usize,
}

impl CpuLimiter {
    fn new(limit: usize) -> Self {
        let limit = limit.max(1);
        Self {
            semaphore: Arc::new(Semaphore::new(limit)),
            limit,
        }
    }
}

static CPU_LIMITER: OnceLock<CpuLimiter> = OnceLock::new();

fn default_cpu_limit() -> usize {
    std::env::var("FHE_CPU_CONCURRENCY_LIMIT")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or_else(|| {
            std::thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(4)
        })
}

pub(crate) fn init_cpu_limiter(limit: usize) {
    let _ = CPU_LIMITER.set(CpuLimiter::new(limit));
}

fn cpu_limiter() -> &'static CpuLimiter {
    CPU_LIMITER.get_or_init(|| CpuLimiter::new(default_cpu_limit()))
}

pub(crate) async fn run_cpu_bound<F, T>(f: F) -> Result<T, FheError>
where
    F: FnOnce() -> Result<T, FheError> + Send + 'static,
    T: Send + 'static,
{
    let limiter = cpu_limiter();
    let queue_start = Instant::now();
    let permit = limiter
        .semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| FheError::Internal("CPU limiter closed".to_string()))?;
    let queue_ms = queue_start.elapsed().as_millis();
    if queue_ms > 0 {
        let in_flight = limiter
            .limit
            .saturating_sub(limiter.semaphore.available_permits());
        tracing::info!(
            cpu_queue_ms = queue_ms as u64,
            cpu_in_flight = in_flight,
            cpu_limit = limiter.limit,
            "cpu queue wait"
        );
    }

    let result = task::spawn_blocking(f)
        .await
        .map_err(|error| FheError::Internal(format!("CPU task failed: {error}")))?;
    drop(permit);
    result
}

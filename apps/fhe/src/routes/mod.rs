//! HTTP Route handlers

mod batch;
mod compliance;
mod country;
mod dob;
mod health;
mod keys;
mod liveness;

use std::sync::{Arc, OnceLock};
use std::time::Instant;

use tokio::sync::Semaphore;
use tokio::task;

use crate::error::FheError;

pub use batch::encrypt_batch;
pub use compliance::encrypt_compliance_level;
pub use country::encrypt_country_code;
pub use dob::{encrypt_dob_days, verify_age_from_dob};
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
    let queue_ms = queue_start.elapsed().as_millis() as u64;
    let in_flight = limiter
        .limit
        .saturating_sub(limiter.semaphore.available_permits());

    // Create span for the CPU-bound task with queue metrics
    let task_span = tracing::info_span!(
        "fhe.cpu_task",
        cpu_queue_ms = queue_ms,
        cpu_in_flight = in_flight,
        cpu_limit = limiter.limit
    );

    // Enter the span and pass it into the blocking closure
    // so child spans created inside are properly parented
    let result = task::spawn_blocking(move || {
        let _guard = task_span.enter();
        f()
    })
    .await
    .map_err(|error| FheError::Internal(format!("CPU task failed: {error}")))?;
    drop(permit);
    result
}

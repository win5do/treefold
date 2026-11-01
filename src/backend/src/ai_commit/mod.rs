//! AI Commit generates editable text only. A bounded in-memory job registry
//! supports explicit cancellation independent of the HTTP response lifetime.
//! Up to three jobs execute concurrently. Queue time does not consume the
//! 60-second execution budget; canceled jobs never start their command. Completed
//! results expire after five minutes. No job creates a Treefold Session or commit.
mod process;
#[cfg(test)]
mod tests;

use anyhow::Result;
use parking_lot::Mutex;
use serde::Serialize;
use std::{
    collections::HashMap,
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Semaphore, watch};

pub const TIMEOUT: Duration = Duration::from_secs(60);
pub(crate) use process::{git_output, run};

#[derive(Clone, Debug, Serialize)]
pub struct Job {
    pub id: String,
    pub status: String,
    pub message: Option<String>,
    pub error: Option<String>,
    pub elapsed_ms: u64,
}
struct Entry {
    job: Job,
    cancel: watch::Sender<bool>,
    updated: Instant,
}
#[derive(Clone)]
pub struct Jobs {
    entries: Arc<Mutex<HashMap<String, Entry>>>,
    permits: Arc<Semaphore>,
}
impl Default for Jobs {
    fn default() -> Self {
        Self {
            entries: Arc::default(),
            permits: Arc::new(Semaphore::new(3)),
        }
    }
}
impl Jobs {
    pub fn start<F>(&self, work: F) -> Result<Job>
    where
        F: Future<Output = Result<String>> + Send + 'static,
    {
        self.start_with_timeout(work, TIMEOUT)
    }
    fn start_with_timeout<F>(&self, work: F, timeout: Duration) -> Result<Job>
    where
        F: Future<Output = Result<String>> + Send + 'static,
    {
        let (cancel, mut canceled) = watch::channel(false);
        let job = Job {
            id: crate::ids::new_id(),
            status: "queued".into(),
            message: None,
            error: None,
            elapsed_ms: 0,
        };
        {
            let mut entries = self.entries.lock();
            entries.retain(|_, entry| {
                matches!(entry.job.status.as_str(), "queued" | "running")
                    || entry.updated.elapsed() < Duration::from_secs(300)
            });
            anyhow::ensure!(
                entries.len() < 128,
                "Too many AI Commit requests; try again later"
            );
            entries.insert(
                job.id.clone(),
                Entry {
                    job: job.clone(),
                    cancel,
                    updated: Instant::now(),
                },
            );
        }
        let jobs = self.clone();
        let id = job.id.clone();
        tokio::spawn(async move {
            let permit = tokio::select! {
                biased;
                _ = canceled.changed() => return,
                permit = jobs.permits.acquire() => match permit { Ok(permit) => permit, Err(_) => return },
            };
            let started = Instant::now();
            {
                let mut entries = jobs.entries.lock();
                if let Some(entry) = entries.get_mut(&id) {
                    if entry.job.status == "canceled" {
                        return;
                    }
                    entry.job.status = "running".into();
                }
            }
            let result = tokio::select! {
                biased;
                _ = canceled.changed() => None,
                result = tokio::time::timeout(timeout, work) => Some(result),
            };
            drop(permit);
            let mut entries = jobs.entries.lock();
            if let Some(entry) = entries.get_mut(&id) {
                // A cancellation accepted before completion always wins.
                if entry.job.status == "canceled" {
                    return;
                }
                entry.job.elapsed_ms = started.elapsed().as_millis() as u64;
                entry.updated = Instant::now();
                match result {
                    Some(Ok(Ok(message))) => {
                        entry.job.status = "succeeded".into();
                        entry.job.message = Some(message);
                    }
                    Some(Ok(Err(error))) => {
                        entry.job.status = "failed".into();
                        entry.job.error = Some(format!("{error:#}"));
                    }
                    Some(Err(_)) => {
                        entry.job.status = "timed_out".into();
                    }
                    None => {
                        entry.job.status = "canceled".into();
                    }
                }
            }
        });
        Ok(job)
    }
    pub fn get(&self, id: &str) -> Option<Job> {
        self.entries.lock().get(id).map(|entry| entry.job.clone())
    }
    pub fn cancel(&self, id: &str) -> Option<Job> {
        let mut entries = self.entries.lock();
        let entry = entries.get_mut(id)?;
        if matches!(entry.job.status.as_str(), "queued" | "running") {
            entry.job.status = "canceled".into();
            entry.updated = Instant::now();
            let _ = entry.cancel.send(true);
        }
        Some(entry.job.clone())
    }
}

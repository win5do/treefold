//! Serialize lifecycle changes within one Workspace tree, without blocking other trees.
use super::{AppError, AppState, Result};
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock, Weak},
};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

type Locks = HashMap<String, Weak<AsyncMutex<()>>>;
static LOCKS: OnceLock<Mutex<Locks>> = OnceLock::new();

pub(super) async fn lock(state: &AppState, id: &str) -> Result<OwnedMutexGuard<()>> {
    let workspace = state.store.workspace(id).await?;
    let root = workspace.parent_workspace_id.as_deref().unwrap_or(id);
    let key = format!("{}:{root}", state.settings.treefold_home().display());
    let mutex = {
        let mut locks = LOCKS.get_or_init(Default::default).lock();
        locks.retain(|_, value| value.strong_count() > 0);
        let mutex = locks.get(&key).and_then(Weak::upgrade).unwrap_or_default();
        locks.insert(key, Arc::downgrade(&mutex));
        mutex
    };
    Ok(mutex.lock_owned().await)
}

/// Caller holds the tree lock, preventing a new Finish from starting during this check.
pub(super) async fn ensure_idle(state: &AppState, id: &str) -> Result<()> {
    let workspace = state.store.workspace(id).await?;
    let root = workspace.parent_workspace_id.as_deref().unwrap_or(id);
    let mut ids: Vec<_> = state
        .store
        .forks(root)
        .await?
        .into_iter()
        .map(|item| item.id)
        .collect();
    ids.push(root.to_owned());
    let workers = super::finish_batch::workers().lock().await;
    if ids.iter().any(|id| workers.contains(id)) {
        return Err(AppError::BadRequest(
            "Finish is still running in this Workspace".into(),
        ));
    }
    Ok(())
}

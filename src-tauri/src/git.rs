use std::{
    collections::HashMap,
    path::Path,
    process::{Command, ExitStatus, Output},
    sync::{Arc, OnceLock, Weak},
};

use parking_lot::Mutex;

static REPOSITORY_LOCKS: OnceLock<Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>> =
    OnceLock::new();

pub type CommandResult<T> = std::result::Result<T, String>;

pub fn output(dir: &Path, args: &[&str]) -> CommandResult<String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|error| format!("git: {error}"))?;
    parse_output(output)
}

pub fn output_with_env(dir: &Path, args: &[&str], env: &[(&str, &str)]) -> CommandResult<String> {
    let output = Command::new("git")
        .current_dir(dir)
        .args(args)
        .envs(env.iter().copied())
        .output()
        .map_err(|error| format!("git: {error}"))?;
    parse_output(output)
}

pub fn status(dir: &Path, args: &[&str]) -> CommandResult<ExitStatus> {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .status()
        .map_err(|error| format!("git: {error}"))
}

pub async fn output_async(dir: &Path, args: &[&str]) -> CommandResult<String> {
    let output = tokio::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| format!("git: {error}"))?;
    parse_output(output)
}

pub async fn status_async(dir: &Path, args: &[&str]) -> CommandResult<ExitStatus> {
    tokio::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .kill_on_drop(true)
        .status()
        .await
        .map_err(|error| format!("git: {error}"))
}

pub async fn blocking<T, F>(operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Git operation task failed: {error}"))
}

/// Serialize a complete Git mutation for one canonical common directory while
/// allowing unrelated repositories to continue in parallel.
pub async fn blocking_for<T, F>(git_common_dir: &Path, operation: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let lock = repository_lock(git_common_dir);
    let _guard = lock.lock().await;
    blocking(operation).await
}

pub async fn with_repository_lock<T, F, Fut>(git_common_dir: &Path, operation: F) -> T
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let lock = repository_lock(git_common_dir);
    let _guard = lock.lock().await;
    operation().await
}

fn repository_lock(git_common_dir: &Path) -> Arc<tokio::sync::Mutex<()>> {
    let key = std::fs::canonicalize(git_common_dir)
        .unwrap_or_else(|_| git_common_dir.to_path_buf())
        .to_string_lossy()
        .into_owned();
    let mut locks = REPOSITORY_LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock();
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}

fn parse_output(output: Output) -> CommandResult<String> {
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    #[test]
    fn captures_sync_git_output() {
        assert!(
            super::output(Path::new("."), &["--version"])
                .expect("read Git version")
                .starts_with("git version")
        );
    }

    #[tokio::test]
    async fn captures_async_git_output() {
        assert!(
            super::output_async(Path::new("."), &["--version"])
                .await
                .expect("read Git version")
                .starts_with("git version")
        );
    }
}

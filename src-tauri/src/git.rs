use std::{
    path::Path,
    process::{Command, ExitStatus, Output},
};

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
        assert!(super::output(Path::new("."), &["--version"])
            .expect("read Git version")
            .starts_with("git version"));
    }

    #[tokio::test]
    async fn captures_async_git_output() {
        assert!(super::output_async(Path::new("."), &["--version"])
            .await
            .expect("read Git version")
            .starts_with("git version"));
    }
}

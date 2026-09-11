use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, bail};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::{io::AsyncWriteExt, net::UnixListener, sync::oneshot};

pub const ARGUMENT: &str = "--await-terminal";
const READY_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct TerminalSize {
    pub rows: u16,
    pub cols: u16,
}

impl TerminalSize {
    pub fn valid(self) -> bool {
        (2..=1000).contains(&self.rows) && (2..=1000).contains(&self.cols)
    }
}

struct PendingLaunch {
    socket: PathBuf,
    ready: oneshot::Sender<TerminalSize>,
}

#[derive(Clone, Default)]
pub struct LaunchGates(Arc<Mutex<HashMap<String, PendingLaunch>>>);

impl LaunchGates {
    pub fn prepare(&self, id: &str, command: Vec<String>) -> anyhow::Result<Vec<String>> {
        self.prepare_with_timeout(id, command, READY_TIMEOUT)
    }

    fn prepare_with_timeout(
        &self,
        id: &str,
        command: Vec<String>,
        timeout: Duration,
    ) -> anyhow::Result<Vec<String>> {
        // Keep the Unix socket path short even when TREEFOLD_HOME is a long path.
        // TempDir's private directory also restricts access to the launch permit.
        let directory = tempfile::Builder::new()
            .prefix("treefold-launch-")
            .tempdir_in("/tmp")?;
        let socket = directory.path().join("ready.sock");
        let listener = UnixListener::bind(&socket)?;
        let (ready, receiver) = oneshot::channel();
        self.0.lock().insert(
            id.into(),
            PendingLaunch {
                socket: socket.clone(),
                ready,
            },
        );
        let gates = Arc::downgrade(&self.0);
        let id = id.to_owned();
        let task_socket = socket.clone();
        tokio::spawn(async move {
            let result = tokio::time::timeout(timeout, async {
                let size = receiver.await.context("terminal launch cancelled")?;
                let (mut stream, _) = listener.accept().await?;
                let mut permit = serde_json::to_vec(&size)?;
                permit.push(b'\n');
                stream.write_all(&permit).await?;
                anyhow::Ok(())
            })
            .await;
            if !matches!(result, Ok(Ok(()))) {
                log::warn!("terminal launch did not become ready: session={id}");
            }
            if let Some(gates) = gates.upgrade() {
                let mut gates = gates.lock();
                if gates
                    .get(&id)
                    .is_some_and(|entry| entry.socket == task_socket)
                {
                    gates.remove(&id);
                }
            }
            drop(listener);
            drop(directory);
        });
        let mut wrapped = vec![
            std::env::current_exe()?.to_string_lossy().into_owned(),
            ARGUMENT.into(),
            socket.to_string_lossy().into_owned(),
            "--".into(),
        ];
        wrapped.extend(command);
        Ok(wrapped)
    }

    pub fn token(&self, id: &str) -> Option<PathBuf> {
        self.0.lock().get(id).map(|pending| pending.socket.clone())
    }

    pub fn ready(&self, id: &str, token: &std::path::Path, size: TerminalSize) {
        let mut gates = self.0.lock();
        if size.valid()
            && gates.get(id).is_some_and(|pending| pending.socket == token)
            && let Some(pending) = gates.remove(id)
        {
            let _ = pending.ready.send(size);
        }
    }

    pub fn cancel(&self, id: &str) {
        self.0.lock().remove(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn readiness_is_scoped_to_the_launch_and_valid_dimensions() {
        let gates = LaunchGates::default();
        let command = vec![
            "codex".into(),
            "--yolo".into(),
            "a prompt with spaces".into(),
        ];
        let wrapped = gates.prepare("session", command.clone()).unwrap();
        assert_eq!(logical_command(&wrapped), command);
        let token = gates.token("session").unwrap();
        let mut stream = tokio::net::UnixStream::connect(&token).await.unwrap();
        gates.ready(
            "session",
            &PathBuf::from("stale-launch"),
            TerminalSize { rows: 24, cols: 80 },
        );
        gates.ready("session", &token, TerminalSize { rows: 0, cols: 80 });
        let mut bytes = Vec::new();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), stream.read_to_end(&mut bytes))
                .await
                .is_err()
        );
        gates.ready("session", &token, TerminalSize { rows: 33, cols: 99 });
        stream.read_to_end(&mut bytes).await.unwrap();
        let size: TerminalSize = serde_json::from_slice(&bytes).unwrap();
        assert_eq!((size.rows, size.cols), (33, 99));
        assert!(gates.token("session").is_none());
    }

    #[tokio::test]
    async fn cancelled_and_expired_launches_remove_their_socket() {
        for cancel in [true, false] {
            let gates = LaunchGates::default();
            gates
                .prepare_with_timeout("session", vec!["codex".into()], Duration::from_millis(50))
                .unwrap();
            let path = gates.token("session").unwrap();
            if cancel {
                gates.cancel("session");
            }
            tokio::time::timeout(Duration::from_secs(1), async {
                while path.exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            assert!(gates.token("session").is_none());
        }
    }
}

pub fn logical_command(command: &[String]) -> Vec<String> {
    if command.get(1).is_some_and(|arg| arg == ARGUMENT)
        && command.get(3).is_some_and(|arg| arg == "--")
    {
        command[4..].to_vec()
    } else {
        command.to_vec()
    }
}

/// This process is the amux-managed PTY child. exec preserves its PID, process
/// group, PTY, environment, and exit tracking when the real command starts.
pub fn run() -> anyhow::Result<()> {
    use std::io::BufRead;
    use std::os::unix::{net::UnixStream, process::CommandExt};

    let mut args = std::env::args_os().skip(2);
    let socket = args.next().context("missing terminal readiness socket")?;
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--")) {
        bail!("missing terminal launch command separator");
    }
    let executable = args.next().context("missing terminal launch command")?;
    let stream = UnixStream::connect(socket).context("connect terminal launch gate")?;
    stream.set_read_timeout(Some(READY_TIMEOUT + Duration::from_secs(5)))?;
    let mut line = String::new();
    std::io::BufReader::new(stream)
        .read_line(&mut line)
        .context("waiting for terminal readiness; reopen or restart this Session")?;
    if line.is_empty() {
        bail!(
            "terminal was not ready within 30 seconds or startup was cancelled; restart this Session"
        );
    }
    let size: TerminalSize = serde_json::from_str(&line)?;
    if !size.valid() {
        bail!("invalid terminal dimensions");
    }
    let dimensions = libc::winsize {
        ws_row: size.rows,
        ws_col: size.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    // SAFETY: dimensions is a valid winsize for the duration of this ioctl;
    // stdin is the PTY slave supplied by amux. Failure prevents command launch.
    if unsafe { libc::ioctl(libc::STDIN_FILENO, libc::TIOCSWINSZ, &dimensions) } == -1 {
        return Err(std::io::Error::last_os_error()).context("size terminal before command launch");
    }
    Err(std::process::Command::new(executable).args(args).exec()).context("launch terminal command")
}

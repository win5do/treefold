use std::{collections::BTreeMap, sync::Arc, time::Duration};

use amux::{
    client::Client,
    config::Config,
    daemon::Daemon,
    model::{CreateWorkspaceRequest, IoMode, Process, ProcessState, RunRequest, StopRequest},
    protocol::Response,
};
use anyhow::{anyhow, bail, Context};
use http::Method;
use tokio::sync::Mutex;
use tokio_tungstenite::WebSocketStream;

use crate::model::Session;

const REPLAY_BYTES: usize = 64 * 1024;
const SETUP_SHELL_WRAPPER: &str = r#"set +e
"$SHELL" -lc "$TREEFOLD_SETUP_COMMAND"
treefold_setup_status=$?
printf '\n[Treefold setup exited with status %s]\n' "$treefold_setup_status"
unset TREEFOLD_SETUP_COMMAND treefold_setup_status
exec "$SHELL" -l"#;

#[derive(Clone)]
pub struct TerminalManager {
    client: Client,
    daemon_start: Arc<Mutex<()>>,
    embedded_shims: bool,
}

impl TerminalManager {
    pub fn new(config: Config) -> Self {
        Self {
            client: Client::new(config),
            daemon_start: Arc::new(Mutex::new(())),
            embedded_shims: false,
        }
    }

    async fn ensure_runtime(&self) -> anyhow::Result<()> {
        if self.client.ready().await {
            return Ok(());
        }
        let _guard = self.daemon_start.lock().await;
        if self.client.ready().await {
            return Ok(());
        }
        let daemon = if self.embedded_shims {
            Daemon::with_embedded_shims(self.client.config.clone())?
        } else {
            Daemon::with_shim_command(
                self.client.config.clone(),
                std::env::current_exe()?,
                vec!["--amux-shim".into()],
            )?
        };
        tokio::spawn(async move {
            if let Err(error) = daemon.serve(None).await {
                log::error!("embedded amux daemon stopped: {error:#}");
            }
        });
        for _ in 0..100 {
            if self.client.ready().await {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        bail!("amux daemon did not become ready")
    }

    async fn ensure_workspace(&self, workspace: &str, root_dir: &str) -> anyhow::Result<()> {
        if self
            .client
            .do_empty(Method::GET, &format!("/v1/workspaces/{workspace}"))
            .await
            .is_ok()
        {
            return Ok(());
        }
        self.client
            .do_json(
                Method::POST,
                "/v1/workspaces",
                Some(&CreateWorkspaceRequest {
                    name: workspace.into(),
                    runtime: "host".into(),
                    root_dir: root_dir.into(),
                    ..Default::default()
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn spawn(
        &self,
        session: &Session,
        project_id: &str,
        developer_instructions: Option<&str>,
        codex_extra_args: &[String],
    ) -> anyhow::Result<Process> {
        self.ensure_runtime().await?;
        let workspace = Self::workspace_name(&session.cwd);
        self.ensure_workspace(&workspace, &session.cwd).await?;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let command = if session.kind == "shell" {
            shell_command(&shell, &session.initial_prompt)
        } else {
            let mut command = vec!["codex".into()];
            command.extend(codex_arguments(
                session,
                developer_instructions,
                codex_extra_args,
            ));
            command
        };
        let mut env = BTreeMap::from([
            ("TERM".into(), "xterm-256color".into()),
            ("COLORTERM".into(), "truecolor".into()),
            ("TREEFOLD_SESSION_ID".into(), session.id.clone()),
            ("TREEFOLD_API_TOKEN".into(), session.id.clone()),
            ("TREEFOLD_API_URL".into(), "http://127.0.0.1:7331".into()),
            ("TREEFOLD_WORKSPACE_ID".into(), session.workspace_id.clone()),
            ("TREEFOLD_PROJECT_ID".into(), project_id.into()),
            (
                "AMUX_STATE_DIR".into(),
                self.client.config.state_dir.to_string_lossy().into_owned(),
            ),
            (
                "AMUX_SOCKET".into(),
                self.client.config.socket.to_string_lossy().into_owned(),
            ),
        ]);
        if session.kind == "shell" && !session.initial_prompt.trim().is_empty() {
            env.insert("SHELL".into(), shell);
            env.insert(
                "TREEFOLD_SETUP_COMMAND".into(),
                session.initial_prompt.clone(),
            );
        }
        let bytes = self
            .client
            .do_json(
                Method::POST,
                &format!("/v1/workspaces/{workspace}/processes"),
                Some(&RunRequest {
                    name: session.id.clone(),
                    command,
                    cwd: session.cwd.clone(),
                    env,
                    io_mode: IoMode::Tty,
                    runtime: "host".into(),
                    initial_rows: 40,
                    initial_cols: 120,
                }),
            )
            .await?;
        response_process(&bytes)
    }

    pub fn workspace_name(root_dir: &str) -> String {
        let normalized =
            std::fs::canonicalize(root_dir).unwrap_or_else(|_| std::path::PathBuf::from(root_dir));
        let mut hash = 0xcbf29ce484222325u64;
        for byte in normalized.to_string_lossy().as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        format!("treefold-ws-{hash:016x}")
    }

    pub async fn inspect(&self, id: &str) -> anyhow::Result<Process> {
        self.ensure_runtime().await?;
        let bytes = self
            .client
            .do_empty(Method::GET, &process_path(id, ""))
            .await?;
        response_process(&bytes)
    }

    pub async fn is_running(&self, id: &str) -> bool {
        self.inspect(id)
            .await
            .map(|process| {
                matches!(
                    process.state,
                    ProcessState::Created | ProcessState::Starting | ProcessState::Running
                )
            })
            .unwrap_or(false)
    }

    pub async fn stop(&self, id: &str) -> anyhow::Result<()> {
        self.ensure_runtime().await?;
        self.client
            .do_json(
                Method::POST,
                &process_path(id, "stop"),
                Some(&StopRequest { grace_millis: 500 }),
            )
            .await?;
        Ok(())
    }

    pub async fn remove(&self, id: &str) -> anyhow::Result<()> {
        self.ensure_runtime().await?;
        let process = match self.inspect(id).await {
            Ok(process) => process,
            Err(error) if error.to_string().contains("process_not_found") => return Ok(()),
            Err(error) => return Err(error),
        };
        if matches!(
            process.state,
            ProcessState::Created
                | ProcessState::Starting
                | ProcessState::Running
                | ProcessState::Stopping
        ) {
            if process.state != ProcessState::Stopping {
                self.stop(id).await?;
            }
            self.client
                .do_empty(Method::GET, &process_path(id, "wait"))
                .await?;
        }
        self.client
            .do_empty(Method::DELETE, &process_path(id, ""))
            .await?;
        Ok(())
    }

    pub async fn attach(
        &self,
        id: &str,
    ) -> anyhow::Result<WebSocketStream<tokio::net::UnixStream>> {
        self.ensure_runtime().await?;
        self.client
            .attach(&format!(
                "{}?takeover=true&replay_bytes={REPLAY_BYTES}",
                process_path(id, "attach")
            ))
            .await
    }
}

fn shell_command(shell: &str, initial_command: &str) -> Vec<String> {
    if initial_command.trim().is_empty() {
        vec![shell.into(), "-l".into()]
    } else {
        vec![shell.into(), "-lc".into(), SETUP_SHELL_WRAPPER.into()]
    }
}

#[cfg(test)]
impl Default for TerminalManager {
    fn default() -> Self {
        let root = std::path::PathBuf::from("/tmp").join(format!(
            "treefold-amux-test-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..10]
        ));
        Self {
            client: Client::new(Config {
                state_dir: root.join("state"),
                socket: root.join("amuxd.sock"),
            }),
            daemon_start: Arc::new(Mutex::new(())),
            embedded_shims: true,
        }
    }
}

fn process_path(target: &str, action: &str) -> String {
    format!(
        "/v1/processes/{target}{}",
        if action.is_empty() {
            String::new()
        } else {
            format!("/{action}")
        }
    )
}

fn response_process(bytes: &[u8]) -> anyhow::Result<Process> {
    serde_json::from_slice::<Response>(bytes)?
        .process
        .map(|view| view.process)
        .ok_or_else(|| anyhow!("amux response did not include a process"))
        .context("decode amux process response")
}

fn codex_arguments(
    session: &Session,
    developer_instructions: Option<&str>,
    extra_args: &[String],
) -> Vec<String> {
    let mut arguments = extra_args.to_vec();
    arguments.extend(["-C".into(), session.cwd.clone()]);
    for path in &session.additional_directories {
        arguments.extend(["--add-dir".into(), path.clone()]);
    }
    if !arguments
        .iter()
        .any(|argument| argument == "--no-alt-screen")
    {
        // Treefold already owns the terminal viewport and scrollback. Codex's alternate-screen
        // UI adds a second viewport boundary beside xterm's scrollbar in this embedded context.
        arguments.push("--no-alt-screen".into());
    }
    if let Some(instructions) = developer_instructions {
        let encoded = serde_json::to_string(instructions)
            .expect("serializing developer instructions cannot fail");
        arguments.extend(["-c".into(), format!("developer_instructions={encoded}")]);
    }
    if let Some(codex_id) = &session.codex_session_id {
        arguments.extend(["resume".into(), codex_id.clone()]);
    } else if !session.initial_prompt.is_empty() {
        arguments.push(session.initial_prompt.clone());
    }
    arguments
}

#[cfg(test)]
mod tests {
    use super::{codex_arguments, TerminalManager};
    use crate::model::Session;

    fn session() -> Session {
        Session {
            id: "session-1".into(),
            workspace_id: "workspace-1".into(),
            name: "Codex".into(),
            kind: "codex".into(),
            cwd: "/tmp/primary worktree".into(),
            original_cwd: "/tmp/primary worktree".into(),
            initial_prompt: "Implement the feature".into(),
            codex_session_id: None,
            sidebar_visible: true,
            hidden_at: None,
            evicted_at: None,
            process_id: String::new(),
            process_name: String::new(),
            status: "starting".into(),
            pid: 0,
            process_group_id: 0,
            exit_code: None,
            exit_signal: String::new(),
            command: Vec::new(),
            launch_started_at: String::new(),
            last_attached_at: None,
            created_at: String::new(),
            updated_at: String::new(),
            additional_directories: vec!["/tmp/attached repo".into()],
        }
    }

    #[test]
    fn injects_developer_instructions_without_merging_them_into_the_user_prompt() {
        let session = session();
        let instructions = "Treefold snapshot\npath = \"/tmp/a b\"";
        let arguments = codex_arguments(
            &session,
            Some(instructions),
            &["--model".into(), "gpt-5.4".into()],
        );

        assert_eq!(
            arguments[0..6],
            [
                "--model",
                "gpt-5.4",
                "-C",
                &session.cwd,
                "--add-dir",
                "/tmp/attached repo"
            ]
        );
        let config_index = arguments.iter().position(|value| value == "-c").unwrap();
        let encoded = arguments[config_index + 1]
            .strip_prefix("developer_instructions=")
            .unwrap();
        assert_eq!(
            serde_json::from_str::<String>(encoded).unwrap(),
            instructions
        );
        assert_eq!(arguments.last().unwrap(), &session.initial_prompt);
    }

    #[test]
    fn refreshes_developer_instructions_when_resuming() {
        let mut session = session();
        session.codex_session_id = Some("codex-session-1".into());
        let arguments = codex_arguments(&session, Some("current Treefold snapshot"), &[]);

        assert!(arguments
            .iter()
            .any(|value| value == "developer_instructions=\"current Treefold snapshot\""));
        assert_eq!(
            &arguments[arguments.len() - 2..],
            ["resume", "codex-session-1"]
        );
        assert!(!arguments
            .iter()
            .any(|value| value == &session.initial_prompt));
    }

    #[test]
    fn passes_global_extra_args_through_unchanged() {
        let session = session();
        let configured = vec![
            "--search".into(),
            "--dangerously-bypass-approvals-and-sandbox".into(),
        ];

        let arguments = codex_arguments(&session, None, &configured);
        assert_eq!(&arguments[..configured.len()], configured);
    }

    #[test]
    fn uses_inline_mode_for_the_embedded_terminal_without_duplicate_flags() {
        let session = session();

        let arguments = codex_arguments(&session, None, &[]);
        assert_eq!(
            arguments
                .iter()
                .filter(|argument| argument.as_str() == "--no-alt-screen")
                .count(),
            1
        );

        let configured = vec!["--no-alt-screen".into(), "--search".into()];
        let arguments = codex_arguments(&session, None, &configured);
        assert_eq!(
            arguments
                .iter()
                .filter(|argument| argument.as_str() == "--no-alt-screen")
                .count(),
            1
        );
    }

    #[test]
    fn assigns_one_stable_amux_workspace_per_root_directory() {
        let first = TerminalManager::workspace_name("/tmp/worktree-a");
        let again = TerminalManager::workspace_name("/tmp/worktree-a");
        let other = TerminalManager::workspace_name("/tmp/worktree-b");

        assert_eq!(first, again);
        assert_ne!(first, other);
        assert!(first.starts_with("treefold-ws-"));
    }

    #[test]
    fn setup_shell_runs_the_command_then_stays_interactive() {
        assert_eq!(super::shell_command("/bin/zsh", ""), ["/bin/zsh", "-l"]);
        assert_eq!(
            super::shell_command("/bin/zsh", "rush install"),
            ["/bin/zsh", "-lc", super::SETUP_SHELL_WRAPPER]
        );
        assert!(super::SETUP_SHELL_WRAPPER.contains("Treefold setup exited with status"));
        assert!(super::SETUP_SHELL_WRAPPER.ends_with("exec \"$SHELL\" -l"));
    }
}

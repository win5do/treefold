use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use amux::{
    client::Client,
    config::Config,
    daemon::Daemon,
    model::{
        CreateWorkspaceRequest, IoMode, Process, ProcessEvent, ProcessSnapshot, ProcessState,
        ProcessView, RunRequest, StopRequest,
    },
    protocol::Response,
};
use anyhow::{Context, anyhow, bail};
use http::Method;
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio_tungstenite::WebSocketStream;

use crate::{DEFAULT_API_URL, model::Session};

const REPLAY_BYTES: usize = 64 * 1024;
pub(crate) mod launch_gate;
type ProcessStateMap = Arc<tokio::sync::RwLock<BTreeMap<String, (ProcessView, Option<String>)>>>;
const SETUP_SHELL_WRAPPER: &str = r#"set +e
"$SHELL" -lc "$TREEFOLD_SETUP_COMMAND"
treefold_setup_status=$?
printf '\n[Treefold setup exited with status %s]\n' "$treefold_setup_status"
unset TREEFOLD_SETUP_COMMAND treefold_setup_status
exec "$SHELL" -l"#;

#[derive(Clone)]
pub struct TerminalManager {
    client: Client,
    daemon_name: Arc<String>,
    daemon_start: Arc<Mutex<()>>,
    embedded_shims: bool,
    bridge_started: Arc<AtomicBool>,
    process_events: tokio::sync::broadcast::Sender<TreefoldProcessEvent>,
    snapshot_events: tokio::sync::broadcast::Sender<()>,
    process_state: ProcessStateMap,
    api_url: Arc<String>,
    amux_state_dir: Arc<PathBuf>,
    amux_socket: Arc<PathBuf>,
    treefold_home: Arc<Option<PathBuf>>,
    bundled_bin_dir: Arc<Option<PathBuf>>,
    launch_gates: launch_gate::LaunchGates,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct TreefoldProcessEvent {
    pub event: ProcessEvent,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TreefoldProcessView {
    pub id: String,
    pub workspace_id: String,
    pub group_id: String,
    pub parent_process_id: Option<String>,
    pub session_id: Option<String>,
    pub session_root: bool,
    pub workspace_name: String,
    pub name: String,
    pub command: Vec<String>,
    pub cwd: String,
    pub io_mode: String,
    pub state: String,
    pub pid: i32,
    pub execution: u64,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_code: Option<i32>,
    pub exit_signal: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaemonResourceStatus {
    pub name: String,
    pub running: bool,
    pub started_at: Option<String>,
    pub active_groups: usize,
    pub active_processes: usize,
}

#[derive(Debug, Deserialize)]
struct DaemonRegistration {
    started_at: String,
    active_groups: usize,
    active_processes: usize,
}

impl TerminalManager {
    pub fn new_named(config: Config, daemon_name: String) -> Self {
        let (process_events, _) = tokio::sync::broadcast::channel(1024);
        let (snapshot_events, _) = tokio::sync::broadcast::channel(16);
        Self {
            amux_state_dir: Arc::new(config.state_dir.clone()),
            amux_socket: Arc::new(config.socket.clone()),
            client: Client::named(config, &daemon_name),
            daemon_name: Arc::new(daemon_name),
            daemon_start: Arc::new(Mutex::new(())),
            embedded_shims: false,
            bridge_started: Arc::new(AtomicBool::new(false)),
            process_events,
            snapshot_events,
            process_state: Arc::new(tokio::sync::RwLock::new(BTreeMap::new())),
            api_url: Arc::new(DEFAULT_API_URL.into()),
            treefold_home: Arc::new(None),
            bundled_bin_dir: Arc::new(None),
            launch_gates: launch_gate::LaunchGates::default(),
        }
    }

    pub fn with_api_url(mut self, api_url: String) -> Self {
        self.api_url = Arc::new(api_url);
        self
    }

    pub fn with_treefold_home(mut self, home: PathBuf) -> Self {
        self.treefold_home = Arc::new(Some(home));
        self
    }

    pub fn with_bundled_bin_dir(mut self, bin_dir: Option<PathBuf>) -> Self {
        self.bundled_bin_dir = Arc::new(bin_dir);
        self
    }

    async fn ensure_runtime(&self) -> anyhow::Result<()> {
        if self.client.ready().await {
            return Ok(());
        }
        let _guard = self.daemon_start.lock().await;
        if self.client.ready().await {
            return Ok(());
        }
        if self.embedded_shims {
            let daemon = Daemon::with_embedded_shims(self.client.config.clone())?;
            tokio::spawn(async move {
                if let Err(error) = daemon.serve(None).await {
                    log::error!("embedded amux daemon stopped: {error:#}");
                }
            });
        } else {
            self.client
                .ensure_daemon_with(std::env::current_exe()?, vec!["--amux-daemon".into()])
                .await?;
        }
        for _ in 0..100 {
            if self.client.ready().await {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        bail!("amux daemon did not become ready")
    }

    pub async fn connect_existing(&self) {
        if self.client.ready().await {
            self.start_event_bridge();
        }
    }

    pub async fn daemon_status(&self) -> DaemonResourceStatus {
        let stopped = || DaemonResourceStatus {
            name: self.daemon_name.as_ref().clone(),
            running: false,
            started_at: None,
            active_groups: 0,
            active_processes: 0,
        };
        if !self.client.ready().await {
            return stopped();
        }
        let registration = std::fs::read(self.client.config.state_dir.join("daemon.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<DaemonRegistration>(&bytes).ok());
        match registration {
            Some(value) => DaemonResourceStatus {
                name: self.daemon_name.as_ref().clone(),
                running: true,
                started_at: Some(value.started_at),
                active_groups: value.active_groups,
                active_processes: value.active_processes,
            },
            None => DaemonResourceStatus {
                running: true,
                ..stopped()
            },
        }
    }

    /// Stops the existing daemon without triggering lazy startup.
    pub async fn stop_daemon(&self) -> anyhow::Result<bool> {
        if !self.client.ready().await {
            return Ok(false);
        }
        self.client.do_empty(Method::POST, "/v1/admin/stop").await?;
        Ok(true)
    }

    #[allow(dead_code)]
    pub fn subscribe_process_events(
        &self,
    ) -> tokio::sync::broadcast::Receiver<TreefoldProcessEvent> {
        self.process_events.subscribe()
    }

    pub fn subscribe_snapshot_events(&self) -> tokio::sync::broadcast::Receiver<()> {
        self.snapshot_events.subscribe()
    }

    pub async fn process_snapshot(&self) -> Vec<TreefoldProcessView> {
        if !self.client.ready().await {
            return Vec::new();
        }
        self.process_state
            .read()
            .await
            .values()
            .map(|(view, session_id)| treefold_process_view(view, session_id.clone()))
            .collect()
    }

    /// Returns a fresh daemon snapshot without starting a missing daemon.
    pub async fn existing_processes(&self) -> anyhow::Result<Option<Vec<TreefoldProcessView>>> {
        if !self.client.ready().await {
            return Ok(None);
        }
        let bytes = self
            .client
            .do_empty(Method::GET, "/v1/processes/snapshot")
            .await?;
        let snapshot = serde_json::from_slice::<ProcessSnapshot>(&bytes)?;
        let views = snapshot
            .processes
            .into_iter()
            .map(|view| (view.process.id.clone(), view))
            .collect::<BTreeMap<_, _>>();
        Ok(Some(
            views
                .values()
                .map(|view| treefold_process_view(view, resolve_session(&view.process.id, &views)))
                .collect(),
        ))
    }

    fn start_event_bridge(&self) {
        if self.bridge_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let client = self.client.clone();
        let sender = self.process_events.clone();
        let snapshot_sender = self.snapshot_events.clone();
        let state = self.process_state.clone();
        tokio::spawn(async move {
            process_event_bridge(client, sender, snapshot_sender, state).await;
        });
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
        self.start_event_bridge();
        let workspace = if session.amux_workspace_name.is_empty() {
            Self::workspace_name(&session.cwd)
        } else {
            session.amux_workspace_name.clone()
        };
        self.ensure_workspace(&workspace, &session.cwd).await?;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let command = if session.kind == "shell" {
            shell_command(&shell, &session.initial_prompt)
        } else if session.kind == "codex" {
            let mut command = vec!["codex".into()];
            command.extend(codex_arguments(
                session,
                developer_instructions,
                codex_extra_args,
            ));
            if let Some(home) = self.treefold_home.as_ref() {
                let log_dir = home.join("logs").join("codex").join(&session.id);
                command.extend([
                    "-c".into(),
                    format!(
                        "log_dir={}",
                        serde_json::to_string(&log_dir.to_string_lossy())?
                    ),
                ]);
            }
            command
        } else {
            session.argv.clone()
        };
        let mut env = BTreeMap::from([
            ("TERM".into(), "xterm-256color".into()),
            ("COLORTERM".into(), "truecolor".into()),
            ("TREEFOLD_API_URL".into(), self.api_url.as_ref().clone()),
            ("TREEFOLD_WORKSPACE_ID".into(), session.workspace_id.clone()),
            ("TREEFOLD_PROJECT_ID".into(), project_id.into()),
            ("AMUX_DAEMON".into(), self.daemon_name.as_ref().clone()),
            ("AMUX_WORKSPACE".into(), workspace.clone()),
            (
                "AMUX_STATE_DIR".into(),
                self.amux_state_dir.to_string_lossy().into_owned(),
            ),
            (
                "AMUX_SOCKET".into(),
                self.amux_socket.to_string_lossy().into_owned(),
            ),
            (
                "TREEFOLD_INTEGRATION_VERSION".into(),
                crate::BUILD_VERSION.into(),
            ),
        ]);
        if let Some(home) = self.treefold_home.as_ref() {
            env.insert("TREEFOLD_HOME".into(), home.to_string_lossy().into_owned());
        }
        if let Some(bin_dir) = self.bundled_bin_dir.as_ref() {
            let inherited = std::env::var("PATH").unwrap_or_default();
            env.insert(
                "PATH".into(),
                format!("{}:{inherited}", bin_dir.to_string_lossy()),
            );
        }
        if session.kind != "command" {
            env.insert("TREEFOLD_SESSION_ID".into(), session.id.clone());
            env.insert("TREEFOLD_API_TOKEN".into(), session.id.clone());
        }
        if session.kind == "shell" && !session.initial_prompt.trim().is_empty() {
            env.insert("SHELL".into(), shell);
            env.insert(
                "TREEFOLD_SETUP_COMMAND".into(),
                session.initial_prompt.clone(),
            );
        }
        let command = if session.kind == "codex" {
            self.launch_gates.prepare(&session.id, command)?
        } else {
            command
        };
        let bytes = self
            .client
            .do_json(
                Method::POST,
                &format!("/v1/workspaces/{workspace}/processes"),
                Some(&RunRequest {
                    name: session.amux_process_name.clone(),
                    parent_process_id: None,
                    command,
                    cwd: session.cwd.clone(),
                    env,
                    io_mode: if session.io_mode == "pipe" {
                        IoMode::Pipe
                    } else {
                        IoMode::Tty
                    },
                    runtime: "host".into(),
                    initial_rows: 40,
                    initial_cols: 120,
                }),
            )
            .await;
        let bytes = match bytes {
            Ok(bytes) => bytes,
            Err(error) => {
                self.launch_gates.cancel(&session.id);
                return Err(error);
            }
        };
        response_process(&bytes)
    }

    pub fn terminal_launch_token(&self, id: &str) -> Option<PathBuf> {
        self.launch_gates.token(id)
    }

    pub fn terminal_ready(
        &self,
        id: &str,
        token: &std::path::Path,
        size: launch_gate::TerminalSize,
    ) {
        self.launch_gates.ready(id, token, size);
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

    #[cfg(test)]
    pub async fn inspect(&self, id: &str) -> anyhow::Result<Process> {
        self.ensure_runtime().await?;
        let bytes = self
            .client
            .do_empty(Method::GET, &process_path(id, ""))
            .await?;
        response_process(&bytes)
    }

    pub async fn inspect_existing(
        &self,
        workspace: &str,
        process: &str,
    ) -> anyhow::Result<Option<Process>> {
        if !self.client.ready().await {
            return Ok(None);
        }
        let path = format!("/v1/processes/{workspace}/{process}");
        match self.client.do_empty(Method::GET, &path).await {
            Ok(bytes) => Ok(Some(response_process(&bytes)?)),
            Err(error) if error.to_string().contains("process_not_found") => Ok(None),
            Err(error) => Err(error),
        }
    }

    #[cfg(test)]
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

    pub async fn stop_existing(&self, workspace: &str, process: &str) -> anyhow::Result<bool> {
        self.launch_gates.cancel(process);
        let Some(current) = self.inspect_existing(workspace, process).await? else {
            return Ok(false);
        };
        if !matches!(
            current.state,
            ProcessState::Created | ProcessState::Starting | ProcessState::Running
        ) {
            return Ok(false);
        }
        self.client
            .do_json(
                Method::POST,
                &format!("/v1/processes/{workspace}/{process}/stop"),
                Some(&StopRequest { grace_millis: 500 }),
            )
            .await?;
        Ok(true)
    }

    /// Restart must inspect persisted process names after the daemon is online.
    /// Ordinary removal stays non-starting for Close and cleanup operations.
    pub async fn prepare_restart(&self, workspace: &str, process_name: &str) -> anyhow::Result<()> {
        self.ensure_runtime().await?;
        self.remove_existing(workspace, process_name).await?;
        Ok(())
    }

    /// Removes a process only when its daemon already exists.
    pub async fn remove_existing(
        &self,
        workspace: &str,
        process_name: &str,
    ) -> anyhow::Result<bool> {
        let Some(process) = self.inspect_existing(workspace, process_name).await? else {
            return Ok(false);
        };
        if matches!(
            process.state,
            ProcessState::Created
                | ProcessState::Starting
                | ProcessState::Running
                | ProcessState::Stopping
        ) {
            if process.state != ProcessState::Stopping {
                self.stop_existing(workspace, process_name).await?;
            }
            self.client
                .do_empty(
                    Method::GET,
                    &format!("/v1/processes/{workspace}/{process_name}/wait"),
                )
                .await?;
        }
        self.client
            .do_empty(
                Method::DELETE,
                &format!("/v1/processes/{workspace}/{process_name}"),
            )
            .await?;
        Ok(true)
    }

    pub async fn attach_existing(
        &self,
        workspace: &str,
        process: &str,
        controller_client_id: Option<&str>,
        input_client_id: Option<&str>,
        after_output_sequence: Option<u64>,
    ) -> anyhow::Result<Option<WebSocketStream<tokio::net::UnixStream>>> {
        if !self.client.ready().await {
            return Ok(None);
        }
        let input = input_client_id
            .map(|value| format!("&input_protocol=acked-v1&input_client_id={value}"))
            .unwrap_or_default();
        let control = controller_client_id
            .map(|value| format!("&control=preferred&controller_client_id={value}"))
            .unwrap_or_default();
        let output = controller_client_id
            .map(|_| {
                let after = after_output_sequence
                    .map(|value| format!("&after_output_sequence={value}"))
                    .unwrap_or_default();
                format!("&output_protocol=sequenced-v1{after}")
            })
            .unwrap_or_default();
        Ok(Some(self.client.attach(&format!(
            "/v1/processes/{workspace}/{process}/attach?replay_bytes={REPLAY_BYTES}{control}{input}{output}"
        )).await?))
    }

    pub async fn logs_existing(
        &self,
        workspace: &str,
        process: &str,
        after: u64,
        follow: bool,
    ) -> anyhow::Result<axum::body::Body> {
        self.ensure_runtime().await?;
        let body = self
            .client
            .stream(&format!(
                "/v1/processes/{workspace}/{process}/logs?after={after}&follow={follow}"
            ))
            .await?;
        Ok(axum::body::Body::new(body))
    }
}

pub(crate) fn treefold_process_view(
    view: &ProcessView,
    session_id: Option<String>,
) -> TreefoldProcessView {
    let process = &view.process;
    TreefoldProcessView {
        id: process.id.clone(),
        workspace_id: process.workspace_id.clone(),
        group_id: process.group_id.clone(),
        parent_process_id: process.parent_process_id.clone(),
        session_id,
        session_root: process
            .env
            .get("TREEFOLD_SESSION_ID")
            .is_some_and(|value| !value.is_empty()),
        workspace_name: view.workspace_name.clone(),
        name: process.name.clone(),
        command: launch_gate::logical_command(&process.command),
        cwd: process.cwd.clone(),
        io_mode: format!("{:?}", process.io_mode).to_ascii_lowercase(),
        state: process_state_name(&process.state).into(),
        pid: process.pid,
        execution: process.execution,
        created_at: process.created_at.to_rfc3339(),
        started_at: process.started_at.map(|value| value.to_rfc3339()),
        finished_at: process.finished_at.map(|value| value.to_rfc3339()),
        exit_code: process.exit_code,
        exit_signal: process.exit_signal.clone(),
    }
}

fn process_state_name(state: &ProcessState) -> &'static str {
    match state {
        ProcessState::Created => "created",
        ProcessState::Starting => "starting",
        ProcessState::Running => "running",
        ProcessState::Stopping => "stopping",
        ProcessState::Exited => "exited",
        ProcessState::Failed => "failed",
        ProcessState::Unknown => "unknown",
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
            client: Client::named(
                Config {
                    state_dir: root.join("state"),
                    socket: root.join("amuxd.sock"),
                },
                "treefold-test",
            ),
            daemon_name: Arc::new("treefold-test".into()),
            daemon_start: Arc::new(Mutex::new(())),
            embedded_shims: true,
            bridge_started: Arc::new(AtomicBool::new(false)),
            process_events: tokio::sync::broadcast::channel(1024).0,
            snapshot_events: tokio::sync::broadcast::channel(16).0,
            process_state: Arc::new(tokio::sync::RwLock::new(BTreeMap::new())),
            api_url: Arc::new(DEFAULT_API_URL.into()),
            amux_state_dir: Arc::new(root.join("state")),
            amux_socket: Arc::new(root.join("amuxd.sock")),
            treefold_home: Arc::new(None),
            bundled_bin_dir: Arc::new(None),
            launch_gates: launch_gate::LaunchGates::default(),
        }
    }
}

#[cfg(test)]
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
        .map(|view| {
            let mut process = view.process;
            process.command = launch_gate::logical_command(&process.command);
            process
        })
        .ok_or_else(|| anyhow!("amux response did not include a process"))
        .context("decode amux process response")
}

async fn process_event_bridge(
    client: Client,
    sender: tokio::sync::broadcast::Sender<TreefoldProcessEvent>,
    snapshot_sender: tokio::sync::broadcast::Sender<()>,
    state: ProcessStateMap,
) {
    loop {
        let snapshot = match client
            .do_empty(Method::GET, "/v1/processes/snapshot")
            .await
            .and_then(|bytes| serde_json::from_slice::<ProcessSnapshot>(&bytes).map_err(Into::into))
        {
            Ok(value) => value,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            }
        };
        let mut views = snapshot
            .processes
            .into_iter()
            .map(|v| (v.process.id.clone(), v))
            .collect::<BTreeMap<_, _>>();
        {
            let mut current = state.write().await;
            current.clear();
            for view in views.values() {
                current.insert(
                    view.process.id.clone(),
                    (view.clone(), resolve_session(&view.process.id, &views)),
                );
            }
        }
        let _ = snapshot_sender.send(());
        let path = format!(
            "/v1/processes/events?after={}&instance={}",
            snapshot.sequence, snapshot.daemon_instance_id
        );
        let Ok(mut body) = client.stream(&path).await else {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        };
        let mut pending = Vec::new();
        let mut disconnected = false;
        while let Some(frame) = body.frame().await {
            let data = match frame {
                Ok(value) => value.into_data().unwrap_or_default(),
                Err(_) => {
                    disconnected = true;
                    break;
                }
            };
            pending.extend_from_slice(&data);
            while let Some(index) = pending.iter().position(|v| *v == b'\n') {
                let line = pending.drain(..=index).collect::<Vec<_>>();
                let Ok(event) = serde_json::from_slice::<ProcessEvent>(&line) else {
                    continue;
                };
                views.insert(event.process_id.clone(), event.process.clone());
                let session_id = resolve_session(&event.process_id, &views);
                {
                    let mut current = state.write().await;
                    if matches!(event.kind, amux::model::ProcessEventKind::ProcessRemoved) {
                        current.remove(&event.process_id);
                    } else {
                        current.insert(
                            event.process_id.clone(),
                            (event.process.clone(), session_id.clone()),
                        );
                    }
                }
                let _ = sender.send(TreefoldProcessEvent { event, session_id });
            }
        }
        if !disconnected {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

fn resolve_session(process_id: &str, views: &BTreeMap<String, ProcessView>) -> Option<String> {
    let mut current = views.get(process_id);
    for _ in 0..128 {
        let process = &current?.process;
        if let Some(session) = process
            .env
            .get("TREEFOLD_SESSION_ID")
            .filter(|v| !v.is_empty())
        {
            return Some(session.clone());
        }
        current = process
            .parent_process_id
            .as_deref()
            .and_then(|id| views.get(id));
    }
    None
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
    use std::collections::BTreeMap;

    use amux::model::ProcessView;
    use serde_json::json;

    use super::{TerminalManager, codex_arguments, resolve_session};
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
            visibility: "visible".into(),
            hidden_at: None,
            evicted_at: None,
            amux_workspace_name: TerminalManager::workspace_name("/tmp/primary worktree"),
            amux_process_name: "session-1".into(),
            status: "stopped".into(),
            exit_code: None,
            exit_signal: String::new(),
            argv: Vec::new(),
            io_mode: "tty".into(),
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

        assert!(
            arguments
                .iter()
                .any(|value| value == "developer_instructions=\"current Treefold snapshot\"")
        );
        assert_eq!(
            &arguments[arguments.len() - 2..],
            ["resume", "codex-session-1"]
        );
        assert!(
            !arguments
                .iter()
                .any(|value| value == &session.initial_prompt)
        );
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

    fn process_view(id: &str, parent: Option<&str>, session_id: Option<&str>) -> ProcessView {
        let mut env = serde_json::Map::new();
        if let Some(session_id) = session_id {
            env.insert("TREEFOLD_SESSION_ID".into(), json!(session_id));
        }
        serde_json::from_value(json!({
            "schema_version": 2,
            "id": id,
            "workspace_id": "workspace-1",
            "group_id": "group-1",
            "environment_id": "environment-1",
            "name": id,
            "parent_process_id": parent,
            "command": [id],
            "cwd": "/tmp/worktree",
            "env": env,
            "io_mode": "pipe",
            "runtime": "host",
            "pid": 0,
            "process_group_id": 0,
            "runtime_handle": "",
            "state": "running",
            "exit_code": null,
            "exit_signal": "",
            "error": "",
            "execution": 1,
            "initial_rows": 0,
            "initial_cols": 0,
            "boot_id": "boot-1",
            "created_at": "2026-08-15T00:00:00Z",
            "started_at": "2026-08-15T00:00:00Z",
            "finished_at": null,
            "workspace_name": "workspace-1",
            "target": id
        }))
        .expect("valid process fixture")
    }

    #[test]
    fn resolves_nested_processes_to_the_original_treefold_session() {
        let views = BTreeMap::from([
            (
                "session-root".into(),
                process_view("session-root", None, Some("session-1")),
            ),
            (
                "dev-server".into(),
                process_view("dev-server", Some("session-root"), None),
            ),
            (
                "worker".into(),
                process_view("worker", Some("dev-server"), None),
            ),
            ("standalone".into(), process_view("standalone", None, None)),
        ]);

        assert_eq!(
            resolve_session("worker", &views).as_deref(),
            Some("session-1")
        );
        assert_eq!(resolve_session("standalone", &views), None);
    }
}

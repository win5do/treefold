mod error;
mod git;
mod model;
mod server;
mod settings;
mod store;
mod terminal;

use anyhow::Context;
use sha2::{Digest, Sha256};
use tauri::Manager;

fn amux_identity(home: &std::path::Path) -> anyhow::Result<(String, amux::config::Config)> {
    let normalized = std::fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    let digest = Sha256::digest(normalized.to_string_lossy().as_bytes());
    let name = format!(
        "treefold-{}",
        digest[..16]
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect::<String>()
    );
    let config = amux::config::Config::named(amux::config::state_root()?, &name)?;
    Ok((name, config))
}

pub fn run_amux_group_shim() -> anyhow::Result<()> {
    let mut workspace_dir = None;
    let mut socket = None;
    let mut args = std::env::args().skip(2);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--workspace-dir" => workspace_dir = args.next().map(std::path::PathBuf::from),
            "--socket" => socket = args.next().map(std::path::PathBuf::from),
            _ => anyhow::bail!("unknown amux shim argument: {argument}"),
        }
    }
    let workspace_dir = workspace_dir.context("missing --workspace-dir")?;
    let socket = socket.context("missing --socket")?;
    let ready_fd = std::env::var("AMUX_SHIM_READY_FD")
        .ok()
        .and_then(|value| value.parse().ok());
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(
            amux::shim::GroupShim::load(workspace_dir, socket)?.serve(
                ready_fd,
                std::env::var("AMUX_SHIM_LIFECYCLE_FD")
                    .ok()
                    .and_then(|v| v.parse().ok()),
            ),
        )
}

pub fn run_amux_daemon() -> anyhow::Result<()> {
    let ready_fd = std::env::var("AMUX_DAEMON_READY_FD")
        .ok()
        .and_then(|v| v.parse().ok());
    let config = amux::config::Config::load()?;
    let daemon = amux::daemon::Daemon::with_shim_command(
        config,
        std::env::current_exe()?,
        vec!["--amux-group-shim".into()],
    )?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(daemon.serve(ready_fd))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shutdown = std::sync::Arc::new(std::sync::Mutex::new(None));
    let shutdown_state = shutdown.clone();
    let daemon_stopped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let user_home = app.path().home_dir()?;
            let home = std::env::var_os("TREEFOLD_HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| user_home.join(".treefold"));
            let settings = settings::SettingsStore::open(&home, &user_home)?;
            let store = store::Store::open(&home.join("data/treefold.db"))
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            let (daemon_name, daemon_config) = amux_identity(&home)?;
            let terminals = terminal::TerminalManager::new_named(daemon_config, daemon_name);
            *shutdown_state.lock().expect("lock shutdown state") =
                Some((settings.clone(), terminals.clone()));
            let reconnect = terminals.clone();
            tauri::async_runtime::spawn(async move {
                reconnect.connect_existing().await;
            });
            let state = server::AppState {
                store,
                settings,
                terminals,
            };
            tauri::async_runtime::spawn(async move {
                if let Err(error) = server::serve(state).await {
                    log::error!("Rust API stopped: {error:#}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Treefold")
        .run(move |_app, event| {
            if !matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                return;
            }
            let Some((settings, terminals)) = shutdown.lock().expect("lock shutdown state").clone()
            else {
                return;
            };
            let keep_running = settings
                .load()
                .map(|value| value.amux.keep_daemon_running_on_exit)
                .unwrap_or(false);
            if keep_running {
                return;
            }
            if daemon_stopped.swap(true, std::sync::atomic::Ordering::SeqCst) {
                return;
            }
            let result = tauri::async_runtime::block_on(terminals.stop_daemon());
            if let Err(error) = result {
                daemon_stopped.store(false, std::sync::atomic::Ordering::SeqCst);
                log::error!("failed to stop amux daemon during Treefold exit: {error:#}");
            }
        });
}

mod error;
mod model;
mod server;
mod settings;
mod store;
mod terminal;

use anyhow::Context;
use std::hash::{Hash, Hasher};
use tauri::Manager;

fn amux_config(home: &std::path::Path) -> amux::config::Config {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    home.hash(&mut hasher);
    amux::config::Config {
        state_dir: home.join("data/amux"),
        socket: std::path::PathBuf::from("/tmp")
            .join(format!("treefold-amux-{:016x}", hasher.finish()))
            .join("amuxd.sock"),
    }
}

pub fn run_amux_shim() -> anyhow::Result<()> {
    let mut process_dir = None;
    let mut socket = None;
    let mut args = std::env::args().skip(2);
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--process-dir" => process_dir = args.next().map(std::path::PathBuf::from),
            "--socket" => socket = args.next().map(std::path::PathBuf::from),
            _ => anyhow::bail!("unknown amux shim argument: {argument}"),
        }
    }
    let process_dir = process_dir.context("missing --process-dir")?;
    let socket = socket.context("missing --socket")?;
    let ready_fd = std::env::var("AMUX_SHIM_READY_FD")
        .ok()
        .and_then(|value| value.parse().ok());
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(amux::shim::Shim::load(process_dir, socket)?.serve(ready_fd))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
            let state = server::AppState {
                store,
                settings,
                terminals: terminal::TerminalManager::new(amux_config(&home)),
            };
            tauri::async_runtime::spawn(async move {
                if let Err(error) = server::serve(state).await {
                    log::error!("Rust API stopped: {error:#}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Treefold");
}

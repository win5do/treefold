mod error;
mod git;
mod model;
mod server;
mod settings;
mod store;
mod terminal;

pub const DEFAULT_API_URL: &str = "http://127.0.0.1:15001";

use anyhow::Context;
use sha2::{Digest, Sha256};
use tauri::{
    Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

#[derive(Clone)]
struct ApiEndpoint(String);

#[tauri::command]
fn treefold_api_url(endpoint: tauri::State<'_, ApiEndpoint>) -> String {
    endpoint.0.clone()
}

fn publish_api_url(home: &std::path::Path, api_url: &str) -> anyhow::Result<std::path::PathBuf> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;

    let runtime = home.join("runtime");
    std::fs::create_dir_all(&runtime)?;
    let path = runtime.join("api-url");
    let temporary = runtime.join(format!("api-url.tmp-{}", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temporary)?;
    writeln!(file, "{api_url}")?;
    file.sync_all()?;
    std::fs::rename(&temporary, &path)?;
    Ok(path)
}

fn remove_api_url(path: &std::path::Path, api_url: &str) {
    let owns_file = std::fs::read_to_string(path)
        .map(|value| value.trim() == api_url)
        .unwrap_or(false);
    if owns_file {
        let _ = std::fs::remove_file(path);
    }
}

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_OPEN_ID: &str = "tray-open";
const TRAY_QUIT_ID: &str = "tray-quit";

fn show_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        log::error!("cannot open Treefold: main window is missing");
        return;
    };
    #[cfg(target_os = "macos")]
    if let Err(error) = app.set_activation_policy(tauri::ActivationPolicy::Regular) {
        log::error!("failed to restore Treefold Dock icon: {error}");
        return;
    }
    if let Err(error) = window
        .unminimize()
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
    {
        log::error!("failed to open Treefold window: {error}");
    }
}

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
        .invoke_handler(tauri::generate_handler![treefold_api_url])
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    log::error!("failed to hide Treefold window: {error}");
                    return;
                }
                #[cfg(target_os = "macos")]
                if let Err(error) = window
                    .app_handle()
                    .set_activation_policy(tauri::ActivationPolicy::Accessory)
                {
                    log::error!("failed to remove Treefold Dock icon: {error}");
                }
            }
        })
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
            let settings = settings::SettingsStore::open(&home)?;
            let open_item =
                MenuItem::with_id(app, TRAY_OPEN_ID, "Open Treefold", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItem::with_id(app, TRAY_QUIT_ID, "Quit Treefold", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])?;
            let mut tray = TrayIconBuilder::with_id("treefold")
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .tooltip("Treefold")
                .on_menu_event(|app, event| match event.id() {
                    id if id == TRAY_OPEN_ID => show_main_window(app),
                    id if id == TRAY_QUIT_ID => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;
            let store = store::Store::open(&home.join("data/treefold.db"))
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            let (daemon_name, daemon_config) = amux_identity(&home)?;
            let listener = tauri::async_runtime::block_on(server::bind())?;
            let api_url = format!("http://{}", listener.local_addr()?);
            let api_url_file = publish_api_url(&home, &api_url)?;
            app.manage(ApiEndpoint(api_url.clone()));
            let terminals = terminal::TerminalManager::new_named(daemon_config, daemon_name)
                .with_api_url(api_url.clone());
            *shutdown_state.lock().expect("lock shutdown state") = Some((
                settings.clone(),
                terminals.clone(),
                store.clone(),
                api_url_file,
                api_url.clone(),
            ));
            let state = server::AppState {
                store,
                settings,
                terminals,
            };
            tauri::async_runtime::spawn(async move {
                if let Err(error) = server::serve(listener, state).await {
                    log::error!("Rust API stopped: {error:#}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Treefold")
        .run(move |app, event| {
            match event {
                tauri::RunEvent::Reopen { .. } => {
                    show_main_window(app);
                    return;
                }
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {}
                _ => return,
            }
            let Some((settings, terminals, store, api_url_file, api_url)) =
                shutdown.lock().expect("lock shutdown state").clone()
            else {
                return;
            };
            remove_api_url(&api_url_file, &api_url);
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
            if let Err(error) = store.stop_active_sessions() {
                log::error!("failed to stop persisted Sessions during Treefold exit: {error}");
            }
            if let Err(error) = result {
                daemon_stopped.store(false, std::sync::atomic::Ordering::SeqCst);
                log::error!("failed to stop amux daemon during Treefold exit: {error:#}");
            }
        });
}

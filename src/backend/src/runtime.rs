use crate::{BUILD_VERSION, integration, server, settings, store, terminal};
use anyhow::Context;
use sha2::{Digest, Sha256};

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
    let config = amux::config::Config::named(home.join("data/amux"), &name)?;
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

pub fn run() -> anyhow::Result<()> {
    let user_home = std::env::home_dir().context("Cannot determine the user home directory")?;
    let home = std::env::var_os("TREEFOLD_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| user_home.join(".treefold"));
    std::fs::create_dir_all(home.join("runtime"))?;
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(home.join("runtime/backend.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock).context(
        "Another Treefold backend is using this TREEFOLD_HOME; quit that instance first",
    )?;
    let level = if cfg!(debug_assertions) {
        "debug"
    } else {
        "info"
    };
    let logger = flexi_logger::Logger::try_with_env_or_str(format!(
        "warn,treefold_lib={level},treefold_backend={level}"
    ))?
    .log_to_file(
        flexi_logger::FileSpec::default()
            .directory(home.join("logs"))
            .basename("treefold")
            .suppress_timestamp(),
    )
    .rotate(
        flexi_logger::Criterion::Size(5 * 1024 * 1024),
        flexi_logger::Naming::Numbers,
        flexi_logger::Cleanup::KeepLogFiles(5),
    )
    .format(|writer, now, record| {
        write!(
            writer,
            "{} {} [backend] {}{}",
            now.now()
                .with_timezone(&chrono::Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            record.level(),
            crate::request_context::current_id()
                .map(|id| format!("request_id={id} "))
                .unwrap_or_default(),
            record.args()
        )
    })
    .append()
    .duplicate_to_stderr(flexi_logger::Duplicate::All)
    .start()?;
    log::info!(
        "Treefold backend starting version={} home={}",
        BUILD_VERSION,
        home.display()
    );
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(serve_backend(&home, &user_home));
    runtime.shutdown_timeout(std::time::Duration::from_secs(2));
    logger.shutdown();
    result
}

async fn serve_backend(home: &std::path::Path, user_home: &std::path::Path) -> anyhow::Result<()> {
    let settings = settings::SettingsStore::open(home)?;
    let executable = std::env::current_exe()?;
    let executable_dir = executable
        .parent()
        .context("Backend executable has no parent")?;
    let resource_dir = std::env::var_os("TREEFOLD_RESOURCE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| executable_dir.to_path_buf());
    let integration =
        integration::IntegrationManager::new(home, user_home, &resource_dir, executable_dir)?;
    let store = store::Store::open(&home.join("data"))
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let listener = server::bind().await?;
    let api_url = format!("http://{}", listener.local_addr()?);
    let (daemon_name, daemon_config) = amux_identity(home)?;
    let terminals = terminal::TerminalManager::new_named(daemon_config, daemon_name)
        .with_treefold_home(home.to_path_buf())
        .with_bundled_bin_dir(integration.bundled_bin_dir())
        .with_api_url(api_url.clone());
    let state = server::AppState {
        keymap: crate::keymap::KeymapStore::open(&settings.treefold_home())?,
        store: store.clone(),
        settings: settings.clone(),
        terminals: terminals.clone(),
        runtime: server::RuntimeHub::default(),
        integration,
    };
    let api_url_file = publish_api_url(home, &api_url)?;
    // stdout is a machine-readable startup channel; logs go to stderr/files.
    println!(
        "{}",
        serde_json::json!({"event":"listening","api_url":api_url,"version":BUILD_VERSION})
    );
    use std::io::Write;
    std::io::stdout().flush()?;
    let result = tokio::select! {
        result = server::serve(listener, state) => result,
        result = shutdown_requested() => result,
    };
    remove_api_url(&api_url_file, &api_url);
    if !settings
        .load()
        .map(|value| value.amux.keep_daemon_running_on_exit)
        .unwrap_or(false)
    {
        let (daemon, sessions) =
            tokio::join!(terminals.stop_daemon(), store.stop_active_sessions());
        if let Err(error) = daemon {
            log::error!("failed to stop amux daemon: {error:#}");
        }
        if let Err(error) = sessions {
            log::error!("failed to stop persisted Sessions: {error}");
        }
    }
    log::info!("Treefold backend stopped");
    result
}

async fn shutdown_requested() -> anyhow::Result<()> {
    #[cfg(unix)]
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    // The desktop owns this pipe. EOF also handles an abruptly terminated parent.
    let parent_closed = async {
        if std::env::var_os("TREEFOLD_PARENT_PIPE").is_none() {
            std::future::pending::<()>().await;
        }
        use tokio::io::AsyncReadExt;
        let mut input = tokio::io::stdin();
        let mut byte = [0];
        loop {
            match input.read(&mut byte).await {
                Ok(0) | Err(_) => break,
                Ok(_) if byte[0] == b'q' => break,
                _ => {}
            }
        }
    };
    #[cfg(unix)]
    tokio::select! {
        result = tokio::signal::ctrl_c() => result?,
        _ = terminate.recv() => {},
        _ = parent_closed => {},
    }
    #[cfg(not(unix))]
    tokio::select! {
        result = tokio::signal::ctrl_c() => result?,
        _ = parent_closed => {},
    }
    Ok(())
}

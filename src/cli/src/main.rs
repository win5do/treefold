use std::{env, path::PathBuf, process::Command};

use clap::{Args, CommandFactory, Parser, Subcommand};
use reqwest::{Method, StatusCode, blocking::Client};
use serde_json::{Value, json};

const BUILD_VERSION: &str = match option_env!("TREEFOLD_BUILD_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

#[derive(Debug, Parser)]
#[command(
    name = "treefold",
    version = BUILD_VERSION,
    about = "Treefold workspace and Todo management"
)]
struct Cli {
    /// Emit stable JSON instead of human-readable output.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Option<CliCommand>,
}

#[derive(Debug, Subcommand)]
enum CliCommand {
    /// Open a directory's Project or its local import dialog; omit the path to focus the App.
    Open { path: Option<PathBuf> },
    /// Show the current Treefold-managed Session context.
    Current,
    /// Manage Todos belonging to the current Workspace.
    Todo {
        #[command(subcommand)]
        command: TodoCommand,
    },
    /// Check Treefold App, Session, and amux connectivity.
    Doctor,
    /// Print the Treefold CLI version.
    Version,
}

#[derive(Debug, Subcommand)]
enum TodoCommand {
    List,
    Show {
        id: String,
    },
    Add(TodoAddArgs),
    Edit(TodoEditArgs),
    Remove {
        id: String,
    },
    Block {
        id: String,
        #[arg(long)]
        reason: String,
    },
}

#[derive(Debug, Args)]
struct TodoAddArgs {
    content: String,
}

#[derive(Debug, Args)]
struct TodoEditArgs {
    id: String,
    #[arg(long)]
    content: String,
}

#[derive(Debug)]
struct CliError {
    message: String,
    code: i32,
}

impl CliError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: 2,
        }
    }
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            code: 3,
        }
    }
    fn api(status: StatusCode, message: impl Into<String>) -> Self {
        let code = match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => 4,
            StatusCode::CONFLICT => 5,
            _ if status.is_client_error() => 2,
            _ => 10,
        };
        Self {
            message: message.into(),
            code,
        }
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

fn main() {
    if let Err(error) = run(Cli::parse()) {
        eprintln!("{}", error.message);
        std::process::exit(error.code);
    }
}

fn run(cli: Cli) -> Result<(), CliError> {
    let Some(command) = cli.command else {
        Cli::command()
            .print_help()
            .map_err(|error| CliError::unavailable(error.to_string()))?;
        println!();
        return Ok(());
    };
    match command {
        CliCommand::Open { path } => open_app(path),
        CliCommand::Current => {
            let value =
                ApiClient::from_env()?.request(Method::GET, "/api/v1/agent/current", None)?;
            print_value(&value, cli.json, Output::Current);
            Ok(())
        }
        CliCommand::Todo { command } => run_todo(command, cli.json),
        CliCommand::Doctor => run_doctor(cli.json),
        CliCommand::Version => {
            let value = json!({"version": BUILD_VERSION});
            if cli.json {
                print_json(&value)
            } else {
                println!("treefold {BUILD_VERSION}")
            }
            Ok(())
        }
    }
}

fn run_todo(command: TodoCommand, json_output: bool) -> Result<(), CliError> {
    let client = ApiClient::from_env()?;
    let (method, path, body, output) = match command {
        TodoCommand::List => (
            Method::GET,
            "/api/v1/agent/todos".into(),
            None,
            Output::TodoList,
        ),
        TodoCommand::Show { id } => (
            Method::GET,
            format!("/api/v1/agent/todos/{id}"),
            None,
            Output::Todo,
        ),
        TodoCommand::Add(args) => (
            Method::POST,
            "/api/v1/agent/todos".into(),
            Some(json!({"content": args.content})),
            Output::Todo,
        ),
        TodoCommand::Edit(args) => (
            Method::PATCH,
            format!("/api/v1/agent/todos/{}", args.id),
            Some(json!({"content": args.content})),
            Output::Todo,
        ),
        TodoCommand::Remove { id } => (
            Method::DELETE,
            format!("/api/v1/agent/todos/{id}"),
            None,
            Output::Removed,
        ),
        TodoCommand::Block { id, reason } => {
            if reason.trim().is_empty() {
                return Err(CliError::invalid("--reason must not be empty"));
            }
            (
                Method::POST,
                format!("/api/v1/agent/todos/{id}/block"),
                Some(json!({"reason": reason})),
                Output::Todo,
            )
        }
    };
    let value = client.request(method, &path, body.as_ref())?;
    print_value(&value, json_output, output);
    Ok(())
}

fn run_doctor(json_output: bool) -> Result<(), CliError> {
    let api_url = api_url();
    let mut checks = vec![json!({
        "name": "app_api",
        "ok": Client::new().get(format!("{}/api/health", api_url.trim_end_matches('/'))).send().is_ok_and(|response| response.status().is_success()),
        "value": api_url,
    })];
    for name in [
        "TREEFOLD_SESSION_ID",
        "TREEFOLD_WORKSPACE_ID",
        "AMUX_SOCKET",
        "AMUX_STATE_DIR",
        "AMUX_WORKSPACE",
    ] {
        let value = env::var(name).ok().filter(|value| !value.trim().is_empty());
        checks.push(
            json!({"name": name.to_ascii_lowercase(), "ok": value.is_some(), "value": value}),
        );
    }
    let amux_ok = Command::new("amux")
        .args(["daemon", "status", "--json"])
        .output()
        .is_ok_and(|output| output.status.success());
    checks.push(json!({"name": "amux_daemon_connectivity", "ok": amux_ok}));
    let ok = checks.iter().all(|check| check["ok"] == true);
    let value = json!({"ok": ok, "checks": checks});
    if json_output {
        print_json(&value)
    } else {
        for check in value["checks"].as_array().into_iter().flatten() {
            println!(
                "{:<8} {}",
                if check["ok"] == true { "ok" } else { "missing" },
                check["name"].as_str().unwrap_or("unknown")
            );
        }
    }
    if ok {
        Ok(())
    } else {
        Err(CliError::unavailable(
            "Treefold doctor found unavailable components",
        ))
    }
}

fn api_url() -> String {
    env::var("TREEFOLD_API_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let home = env::var_os("TREEFOLD_HOME")
                .map(PathBuf::from)
                .or_else(|| {
                    env::var_os("HOME").map(|home| PathBuf::from(home).join(".treefold"))
                })?;
            std::fs::read_to_string(home.join("runtime/api-url"))
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| "http://127.0.0.1:15001".into())
}

fn open_app(path: Option<PathBuf>) -> Result<(), CliError> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.args(["-a", "Treefold"]);
        if let Some(path) = path {
            command.arg(open_directory_path(path)?);
        }
        if command
            .status()
            .map_err(|error| CliError::unavailable(format!("open Treefold: {error}")))?
            .success()
        {
            Ok(())
        } else {
            Err(CliError::unavailable("open Treefold failed"))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err(CliError::unavailable(
            "treefold open is currently supported on macOS",
        ))
    }
}

fn open_directory_path(path: PathBuf) -> Result<PathBuf, CliError> {
    let path = path
        .canonicalize()
        .map_err(|error| CliError::invalid(format!("cannot open directory: {error}")))?;
    if !path.is_dir() {
        return Err(CliError::invalid("treefold open requires a directory"));
    }
    Ok(path)
}

struct ApiClient {
    client: Client,
    base_url: String,
    token: String,
}
impl ApiClient {
    fn from_env() -> Result<Self, CliError> {
        let token = env::var("TREEFOLD_API_TOKEN")
            .or_else(|_| env::var("TREEFOLD_SESSION_ID"))
            .map_err(|_| {
                CliError::invalid(
                    "not in a Treefold-managed Session: TREEFOLD_API_TOKEN is missing",
                )
            })?;
        Ok(Self {
            client: Client::new(),
            base_url: api_url(),
            token,
        })
    }
    fn request(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Value, CliError> {
        let mut request = self
            .client
            .request(
                method,
                format!("{}{}", self.base_url.trim_end_matches('/'), path),
            )
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().map_err(|error| {
            CliError::unavailable(format!("Treefold App/API unavailable: {error}"))
        })?;
        let status = response.status();
        let value = response.json::<Value>().unwrap_or_else(|_| json!({}));
        if status.is_success() {
            Ok(value)
        } else {
            let code = value["error"]["code"].as_str().unwrap_or("API_ERROR");
            let message = value["error"]["message"]
                .as_str()
                .unwrap_or("Treefold API request failed");
            Err(CliError::api(status, format!("{code}: {message}")))
        }
    }
}

#[derive(Clone, Copy)]
enum Output {
    Current,
    TodoList,
    Todo,
    Removed,
}
fn print_value(value: &Value, json_output: bool, output: Output) {
    if json_output {
        print_json(value);
        return;
    }
    match output {
        Output::Current => {
            println!(
                "Project:    {}",
                value["project"]["name"].as_str().unwrap_or("unknown")
            );
            println!(
                "Workspace:  {}",
                value["workspace"]["name"].as_str().unwrap_or("unknown")
            );
            println!(
                "Session:    {}",
                value["session"]["id"].as_str().unwrap_or("unknown")
            );
            println!(
                "Path:       {}",
                value["workspace"]["path"].as_str().unwrap_or("unknown")
            );
            println!(
                "amux:       {}",
                value["runtime"]["workspace"].as_str().unwrap_or("unknown")
            );
        }
        Output::TodoList => {
            println!("STATUS\tID\tCONTENT");
            for todo in value.as_array().into_iter().flatten() {
                println!(
                    "{}\t{}\t{}",
                    todo["status"].as_str().unwrap_or("unknown"),
                    todo["id"].as_str().unwrap_or("unknown"),
                    todo["content"].as_str().unwrap_or("").replace('\n', " ")
                );
            }
        }
        Output::Todo => println!(
            "{}\t{}\t{}",
            value["status"].as_str().unwrap_or("unknown"),
            value["id"].as_str().unwrap_or("unknown"),
            value["content"].as_str().unwrap_or("")
        ),
        Output::Removed => println!("removed"),
    }
}
fn print_json(value: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("JSON serialization cannot fail")
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_command_is_valid_and_displays_help() {
        assert!(Cli::try_parse_from(["treefold"]).unwrap().command.is_none());
    }
    #[test]
    fn parses_explicit_open() {
        assert!(matches!(
            Cli::try_parse_from(["treefold", "open", "."])
                .unwrap()
                .command,
            Some(CliCommand::Open { .. })
        ));
    }
    #[test]
    fn open_resolves_relative_directories_and_rejects_files() {
        assert_eq!(
            open_directory_path(PathBuf::from(".")).unwrap(),
            std::env::current_dir().unwrap().canonicalize().unwrap()
        );
        assert!(open_directory_path(PathBuf::from("Cargo.toml")).is_err());
        assert!(open_directory_path(PathBuf::from("missing-treefold-directory")).is_err());
    }
}

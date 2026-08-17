use std::{env, path::PathBuf, process::Command};

use clap::{Args, Parser, Subcommand};
use reqwest::{Method, StatusCode, blocking::Client};
use serde_json::{Value, json};

const DEFAULT_API_URL: &str = "http://127.0.0.1:7331";

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
        .unwrap_or_else(|| DEFAULT_API_URL.into())
}

#[derive(Debug, Parser)]
#[command(
    name = "treefold",
    version,
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
    /// Open or focus the Treefold desktop app.
    Open {
        /// Optional directory to open with Treefold.
        path: Option<PathBuf>,
    },
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
    /// List Todos in the current Workspace.
    List,
    /// Show one Todo.
    Show { id: String },
    /// Create a Todo.
    Add(TodoAddArgs),
    /// Edit Todo Markdown content.
    Edit(TodoEditArgs),
    /// Permanently remove a Todo.
    Remove { id: String },
    /// Mark a Todo blocked with a concise reason.
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

pub enum Outcome {
    LaunchApp,
    Done,
}

#[derive(Debug)]
pub struct CliError {
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

    pub fn exit_code(&self) -> i32 {
        self.code
    }
}

impl std::fmt::Display for CliError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CliError {}

pub fn run() -> Result<Outcome, CliError> {
    run_cli(Cli::parse())
}

fn run_cli(cli: Cli) -> Result<Outcome, CliError> {
    let Some(command) = cli.command else {
        return Ok(Outcome::LaunchApp);
    };
    match command {
        CliCommand::Open { path } => open_app(path)?,
        CliCommand::Current => {
            let value =
                ApiClient::from_env()?.request(Method::GET, "/api/v1/agent/current", None)?;
            print_value(&value, cli.json, HumanOutput::Current);
        }
        CliCommand::Todo { command } => run_todo(command, cli.json)?,
        CliCommand::Doctor => run_doctor(cli.json)?,
        CliCommand::Version => {
            let value = json!({"version": env!("CARGO_PKG_VERSION")});
            if cli.json {
                print_json(&value);
            } else {
                println!("treefold {}", env!("CARGO_PKG_VERSION"));
            }
        }
    }
    Ok(Outcome::Done)
}

fn run_todo(command: TodoCommand, json_output: bool) -> Result<(), CliError> {
    let client = ApiClient::from_env()?;
    let (method, path, body, output) = match command {
        TodoCommand::List => (
            Method::GET,
            "/api/v1/agent/todos".into(),
            None,
            HumanOutput::TodoList,
        ),
        TodoCommand::Show { id } => (
            Method::GET,
            format!("/api/v1/agent/todos/{id}"),
            None,
            HumanOutput::Todo,
        ),
        TodoCommand::Add(args) => (
            Method::POST,
            "/api/v1/agent/todos".into(),
            Some(json!({"content": args.content})),
            HumanOutput::Todo,
        ),
        TodoCommand::Edit(args) => (
            Method::PATCH,
            format!("/api/v1/agent/todos/{}", args.id),
            Some(json!({"content": args.content})),
            HumanOutput::Todo,
        ),
        TodoCommand::Remove { id } => (
            Method::DELETE,
            format!("/api/v1/agent/todos/{id}"),
            None,
            HumanOutput::Removed,
        ),
        TodoCommand::Block { id, reason } => {
            if reason.trim().is_empty() {
                return Err(CliError::invalid("--reason must not be empty"));
            }
            todo_action(id, "block", Some(json!({"reason": reason})))
        }
    };
    let value = client.request(method, &path, body.as_ref())?;
    print_value(&value, json_output, output);
    Ok(())
}

fn todo_action(
    id: String,
    action: &str,
    body: Option<Value>,
) -> (Method, String, Option<Value>, HumanOutput) {
    (
        Method::POST,
        format!("/api/v1/agent/todos/{id}/{action}"),
        body,
        HumanOutput::Todo,
    )
}

fn run_doctor(json_output: bool) -> Result<(), CliError> {
    let mut checks = Vec::new();
    let api_url = api_url();
    let api = Client::new()
        .get(format!("{}/api/health", api_url.trim_end_matches('/')))
        .send()
        .map(|response| response.status().is_success())
        .unwrap_or(false);
    checks.push(json!({"name":"app_api", "ok":api, "value":api_url}));
    for name in [
        "TREEFOLD_SESSION_ID",
        "TREEFOLD_WORKSPACE_ID",
        "AMUX_DAEMON",
        "AMUX_WORKSPACE",
        "AMUX_PROCESS_ID",
    ] {
        let value = env::var(name).ok().filter(|value| !value.trim().is_empty());
        checks.push(json!({"name":name.to_ascii_lowercase(), "ok":value.is_some(), "value":value}));
    }
    let daemon = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()
        .and_then(|runtime| {
            amux::config::Config::load()
                .ok()
                .map(|config| runtime.block_on(amux::client::Client::new(config).ready()))
        })
        .unwrap_or(false);
    checks.push(json!({"name":"amux_daemon_connectivity", "ok":daemon, "value":env::var("AMUX_DAEMON").ok()}));
    let ok = checks.iter().all(|check| check["ok"] == true);
    let value = json!({"ok":ok, "checks":checks});
    if json_output {
        print_json(&value);
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

fn open_app(path: Option<PathBuf>) -> Result<(), CliError> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.args(["-a", "Treefold"]);
        if let Some(path) = path {
            command.arg(path);
        }
        let status = command
            .status()
            .map_err(|error| CliError::unavailable(format!("open Treefold: {error}")))?;
        if !status.success() {
            return Err(CliError::unavailable("open Treefold failed"));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err(CliError::unavailable(
            "treefold open is currently supported on macOS",
        ))
    }
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
        if !status.is_success() {
            let code = value["error"]["code"].as_str().unwrap_or("API_ERROR");
            let message = value["error"]["message"]
                .as_str()
                .unwrap_or("Treefold API request failed");
            return Err(CliError::api(status, format!("{code}: {message}")));
        }
        Ok(value)
    }
}

#[derive(Clone, Copy)]
enum HumanOutput {
    Current,
    TodoList,
    Todo,
    Removed,
}

fn print_value(value: &Value, json_output: bool, output: HumanOutput) {
    if json_output {
        print_json(value);
        return;
    }
    match output {
        HumanOutput::Current => {
            println!(
                "Project:    {}",
                value["project"]["name"].as_str().unwrap_or("unknown")
            );
            println!(
                "Workspace: {}",
                value["workspace"]["name"].as_str().unwrap_or("unknown")
            );
            println!(
                "Session:    {}",
                value["session"]["id"].as_str().unwrap_or("unknown")
            );
            println!(
                "Workspace:  {}",
                value["workspace"]["path"].as_str().unwrap_or("unknown")
            );
            println!(
                "Branch:     {}",
                value["workspace"]["git"]["observed_branch"]
                    .as_str()
                    .unwrap_or("-")
            );
            println!(
                "amux:       {}",
                value["runtime"]["workspace"].as_str().unwrap_or("unknown")
            );
        }
        HumanOutput::TodoList => {
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
        HumanOutput::Todo => {
            println!(
                "{}\t{}\t{}",
                value["status"].as_str().unwrap_or("unknown"),
                value["id"].as_str().unwrap_or("unknown"),
                value["content"].as_str().unwrap_or("")
            );
        }
        HumanOutput::Removed => println!("removed"),
    }
}

fn print_json(value: &Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("JSON value serialization cannot fail")
    );
}

#[cfg(test)]
mod tests {
    use super::{Cli, CliCommand, Parser, TodoCommand};

    #[test]
    fn parses_todo_block() {
        let cli =
            Cli::try_parse_from(["treefold", "todo", "block", "todo-1", "--reason", "waiting"])
                .unwrap();
        assert!(matches!(
            cli.command,
            Some(CliCommand::Todo {
                command: TodoCommand::Block { id, reason }
            }) if id == "todo-1" && reason == "waiting"
        ));
    }

    #[test]
    fn no_command_launches_the_app() {
        let cli = Cli::try_parse_from(["treefold"]).unwrap();
        assert!(cli.command.is_none());
    }
}

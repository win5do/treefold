use std::{env, path::PathBuf, process::Command};

use clap::{Args, Parser, Subcommand};
use reqwest::{blocking::Client, Method, StatusCode};
use serde_json::{json, Value};

const DEFAULT_API_URL: &str = "http://127.0.0.1:7331";

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
    /// Edit a Todo title or description.
    Edit(TodoEditArgs),
    /// Permanently remove a Todo.
    Remove { id: String },
    /// Atomically assign a pending Todo to this Session.
    Claim { id: String },
    /// Release a Todo assigned to this Session.
    Release { id: String },
    /// Mark a Todo done.
    Done { id: String },
    /// Mark a Todo blocked with a concise reason.
    Block {
        id: String,
        #[arg(long)]
        reason: String,
    },
}

#[derive(Debug, Args)]
struct TodoAddArgs {
    title: String,
    #[arg(short, long, default_value = "")]
    description: String,
}

#[derive(Debug, Args)]
struct TodoEditArgs {
    id: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    description: Option<String>,
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
            Some(json!({"title": args.title, "description": args.description})),
            HumanOutput::Todo,
        ),
        TodoCommand::Edit(args) => {
            if args.title.is_none() && args.description.is_none() {
                return Err(CliError::invalid(
                    "todo edit requires --title or --description",
                ));
            }
            (
                Method::PATCH,
                format!("/api/v1/agent/todos/{}", args.id),
                Some(json!({"title": args.title, "description": args.description})),
                HumanOutput::Todo,
            )
        }
        TodoCommand::Remove { id } => (
            Method::DELETE,
            format!("/api/v1/agent/todos/{id}"),
            None,
            HumanOutput::Removed,
        ),
        TodoCommand::Claim { id } => todo_action(id, "claim", None),
        TodoCommand::Release { id } => todo_action(id, "release", None),
        TodoCommand::Done { id } => todo_action(id, "done", None),
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
    let api_url = env::var("TREEFOLD_API_URL").unwrap_or_else(|_| DEFAULT_API_URL.into());
    let api = Client::new()
        .get(format!("{}/api/health", api_url.trim_end_matches('/')))
        .send()
        .map(|response| response.status().is_success())
        .unwrap_or(false);
    checks.push(json!({"name":"app_api", "ok":api, "value":api_url}));
    for name in [
        "TREEFOLD_SESSION_ID",
        "TREEFOLD_WORKSPACE_ID",
        "AMUX_SOCKET",
        "AMUX_WORKSPACE",
    ] {
        let value = env::var(name).ok().filter(|value| !value.trim().is_empty());
        checks.push(json!({"name":name.to_ascii_lowercase(), "ok":value.is_some(), "value":value}));
    }
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
            base_url: env::var("TREEFOLD_API_URL").unwrap_or_else(|_| DEFAULT_API_URL.into()),
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
            println!("STATUS\tID\tTITLE");
            for todo in value.as_array().into_iter().flatten() {
                println!(
                    "{}\t{}\t{}",
                    todo["status"].as_str().unwrap_or("unknown"),
                    todo["id"].as_str().unwrap_or("unknown"),
                    todo["title"].as_str().unwrap_or("")
                );
            }
        }
        HumanOutput::Todo => {
            println!(
                "{}\t{}\t{}",
                value["status"].as_str().unwrap_or("unknown"),
                value["id"].as_str().unwrap_or("unknown"),
                value["title"].as_str().unwrap_or("")
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
    fn parses_todo_claim() {
        let cli = Cli::try_parse_from(["treefold", "todo", "claim", "todo-1"]).unwrap();
        assert!(matches!(
            cli.command,
            Some(CliCommand::Todo {
                command: TodoCommand::Claim { id }
            }) if id == "todo-1"
        ));
    }

    #[test]
    fn no_command_launches_the_app() {
        let cli = Cli::try_parse_from(["treefold"]).unwrap();
        assert!(cli.command.is_none());
    }
}

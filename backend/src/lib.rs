mod error;
mod git;
mod ids;
mod integration;
mod model;
mod server;
mod settings;
mod store;
mod terminal;

pub const DEFAULT_API_URL: &str = "http://127.0.0.1:15001";
pub const BUILD_VERSION: &str = match option_env!("TREEFOLD_BUILD_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

mod runtime;

pub use runtime::run;
pub use runtime::{run_amux_daemon, run_amux_group_shim};

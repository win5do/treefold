// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--amux-group-shim") {
        if let Err(error) = treefold_lib::run_amux_group_shim() {
            eprintln!("amux shim failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--amux-daemon") {
        if let Err(error) = treefold_lib::run_amux_daemon() {
            eprintln!("amux daemon failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    match cli::run() {
        Ok(cli::Outcome::LaunchApp) => treefold_lib::run(),
        Ok(cli::Outcome::Done) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(error.exit_code());
        }
    }
}

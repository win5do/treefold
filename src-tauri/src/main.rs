// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
    treefold_lib::run();
}

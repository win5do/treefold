// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--amux-shim") {
        if let Err(error) = treefold_lib::run_amux_shim() {
            eprintln!("amux shim failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
    treefold_lib::run();
}

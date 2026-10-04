fn main() {
    if std::env::args().nth(1).as_deref() == Some("--agent-hook") {
        if let Err(error) = treefold_lib::run_agent_hook() {
            eprintln!("Treefold Agent hook: {error:#}");
        }
        // Metadata is advisory; callback failures must not block the Agent.
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--await-terminal") {
        if let Err(error) = treefold_lib::run_terminal_launch_gate() {
            eprintln!("Treefold terminal launch failed: {error:#}");
            std::process::exit(1);
        }
        return;
    }
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
    if let Err(error) = treefold_lib::run() {
        eprintln!("Treefold backend failed: {error:#}");
        std::process::exit(1);
    }
}

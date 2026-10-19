use super::*;
use serde_json::json;

fn session() -> Session {
    serde_json::from_value(json!({
        "id": "session-review", "workspace_id": "workspace-review", "name": "AI Review",
        "kind": "codex", "cwd": "/tmp/review", "original_cwd": "/tmp/review",
        "initial_prompt": "", "visibility": "visible", "amux_workspace_name": "amux-review",
        "amux_process_name": "session-review", "status": "stopped", "exit_signal": "",
        "argv": [], "io_mode": "pty", "launch_started_at": "", "created_at": "",
        "updated_at": "", "additional_directories": []
    }))
    .unwrap()
}

fn process(state: &str) -> TreefoldProcessView {
    TreefoldProcessView {
        id: "process-review".into(),
        workspace_id: "amux-workspace-id".into(),
        group_id: "group".into(),
        parent_process_id: None,
        session_id: Some("session-review".into()),
        session_root: true,
        workspace_name: "amux-review".into(),
        name: "session-review".into(),
        command: vec!["codex".into()],
        cwd: "/tmp/review".into(),
        io_mode: "pty".into(),
        state: state.into(),
        pid: 1234,
        execution: 1,
        created_at: "".into(),
        started_at: None,
        finished_at: None,
        exit_code: None,
        exit_signal: "".into(),
    }
}

#[test]
fn finish_processes_use_live_state_instead_of_persisted_session_status() {
    let mut session = session();
    for state in ["created", "starting", "running", "stopping"] {
        let processes = affected_processes(&[session.clone()], &[process(state)]);
        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].session_id, session.id);
        assert_eq!(processes[0].name, "AI Review");
        assert_eq!(processes[0].state, state);
        assert_eq!(processes[0].pid, 1234);
    }
    session.status = "running".into();
    for state in ["exited", "failed"] {
        assert!(affected_processes(&[session.clone()], &[process(state)]).is_empty());
    }
    assert!(affected_processes(&[session], &[]).is_empty());
}

#[test]
fn finish_processes_only_include_the_exact_session_roots_delivery_stops() {
    let mut other_workspace = process("running");
    other_workspace.workspace_name = "amux-parent".into();
    let mut background = process("running");
    background.name = "background-server".into();
    background.session_root = false;
    let mut other_session = process("running");
    other_session.name = "another-session".into();
    assert!(
        affected_processes(&[session()], &[other_workspace, background, other_session]).is_empty()
    );
}

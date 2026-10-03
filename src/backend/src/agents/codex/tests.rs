use super::*;
fn context() -> LaunchContext<'static> {
    LaunchContext {
        session_id: "01a08fff908b76b28c1c3826e810b018",
        runtime_dir: None,
        cwd: "/tmp/primary worktree",
        additional_directories: &[],
        initial_prompt: "Implement the feature",
        instructions: None,
        resume_id: None,
        log_dir: None,
    }
}
#[test]
fn injects_developer_instructions_without_merging_them_into_the_user_prompt() {
    let dirs = vec!["/tmp/attached repo".into()];
    let context = LaunchContext {
        session_id: "01a08fff908b76b28c1c3826e810b018",
        runtime_dir: None,
        additional_directories: &dirs,
        ..context()
    };
    let instructions = "Treefold snapshot\npath = \"/tmp/a b\"";
    let arguments = Codex
        .build_args(
            &LaunchContext {
                session_id: "01a08fff908b76b28c1c3826e810b018",
                runtime_dir: None,
                instructions: Some(instructions),
                ..context
            },
            &["--model".into(), "gpt-5.4".into()],
        )
        .unwrap();

    assert_eq!(
        arguments[0..6],
        [
            "--model",
            "gpt-5.4",
            "-C",
            context.cwd,
            "--add-dir",
            "/tmp/attached repo"
        ]
    );
    let config_index = arguments.iter().position(|value| value == "-c").unwrap();
    let encoded = arguments[config_index + 1]
        .strip_prefix("developer_instructions=")
        .unwrap();
    assert_eq!(
        serde_json::from_str::<String>(encoded).unwrap(),
        instructions
    );
    assert_eq!(arguments.last().unwrap(), context.initial_prompt);
}

#[test]
fn refreshes_developer_instructions_when_resuming() {
    let mut context = context();
    context.resume_id = Some("codex-session-1");
    let arguments = Codex
        .build_args(
            &LaunchContext {
                session_id: "01a08fff908b76b28c1c3826e810b018",
                runtime_dir: None,
                instructions: Some("current Treefold snapshot"),
                ..context
            },
            &[],
        )
        .unwrap();

    assert!(
        arguments
            .iter()
            .any(|value| value == "developer_instructions=\"current Treefold snapshot\"")
    );
    assert_eq!(
        &arguments[arguments.len() - 2..],
        ["resume", "codex-session-1"]
    );
    assert!(
        !arguments
            .iter()
            .any(|value| value == context.initial_prompt)
    );
}

#[test]
fn passes_global_extra_args_through_unchanged() {
    let context = context();
    let configured = vec![
        "--search".into(),
        "--dangerously-bypass-approvals-and-sandbox".into(),
    ];

    let arguments = Codex.build_args(&context, &configured).unwrap();
    assert_eq!(&arguments[..configured.len()], configured);
}

#[test]
fn uses_inline_mode_for_the_embedded_terminal_without_duplicate_flags() {
    let context = context();

    let arguments = Codex.build_args(&context, &[]).unwrap();
    assert_eq!(
        arguments
            .iter()
            .filter(|argument| argument.as_str() == "--no-alt-screen")
            .count(),
        1
    );

    let configured = vec!["--no-alt-screen".into(), "--search".into()];
    let arguments = Codex.build_args(&context, &configured).unwrap();
    assert_eq!(
        arguments
            .iter()
            .filter(|argument| argument.as_str() == "--no-alt-screen")
            .count(),
        1
    );
}

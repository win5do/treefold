use super::*;
#[tokio::test]
async fn versions_use_the_configured_cli_and_failure_keeps_it_available() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let mut settings = AgentsSettings::default();
    for (kind, config, script) in [
        ("codex", &mut settings.codex, "printf 'codex-cli 1.2.3\\n'"),
        (
            "claude",
            &mut settings.claude_code,
            "printf '2.3.4 (Claude Code)\\n' >&2",
        ),
        ("opencode", &mut settings.opencode, "exit 1"),
        ("pi", &mut settings.pi, "exec sleep 10"),
    ] {
        let path = dir.path().join(kind);
        std::fs::write(
            &path,
            format!("#!/bin/sh\n[ \"$1\" = --version ] || exit 9\n{script}\n"),
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        config.command = shell_words::quote(&path.to_string_lossy()).into_owned();
    }
    let agents = installations(&settings).await;
    assert!(agents.iter().all(|agent| agent.available));
    assert_eq!(agents[0].version.as_deref(), Some("codex-cli 1.2.3"));
    assert_eq!(agents[1].version.as_deref(), Some("2.3.4 (Claude Code)"));
    assert_eq!(agents[2].version, None);
    assert_eq!(agents[3].version, None);
}

#[test]
fn installation_requires_an_executable_file() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("agent with spaces");
    let config = AgentSettings {
        command: shell_words::quote(&path.to_string_lossy()).into_owned(),
        ..Default::default()
    };
    assert!(detect_installation("pi", &config).is_none());
    std::fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert!(detect_installation("pi", &config).is_none());
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(detect_installation("pi", &config).unwrap(), path);
}

#[test]
fn validates_interactive_commands_without_confusing_values_with_subcommands() {
    for (kind, executable) in [
        ("codex", "codex"),
        ("claude_code", "claude"),
        ("opencode", "opencode"),
        ("pi", "pi"),
    ] {
        for text in ["", "   "] {
            assert_eq!(
                parse_command(kind, text).unwrap(),
                (executable.into(), vec![])
            );
        }
        for value in ["resume", "exec", "run", "a b", "$HOME;$(echo literal)"] {
            let command = format!("{executable} --model {}", shell_words::quote(value));
            assert_eq!(parse_command(kind, &command).unwrap().1, ["--model", value]);
        }
        for args in [
            "resume existing",
            "exec task",
            "login",
            "run task",
            "@prompt.md",
            "'initial prompt'",
            "--model model resume existing",
            "--",
            "--model",
            "--model --help",
            "--future-flag",
            "--future-flag=resume",
            "--future-flag resume",
            "--help",
            "--version",
        ] {
            let error = parse_command(kind, &format!("{executable} {args}")).unwrap_err();
            assert!(
                error.to_string().contains(name(kind).unwrap()),
                "{kind}: {args}: {error}"
            );
        }
    }
}

#[test]
fn understands_each_cli_option_syntax_and_rejects_managed_options() {
    for (kind, commands) in [
        (
            "codex",
            vec![
                "codex --model=resume",
                "codex -mresume",
                "codex -m模型",
                "codex -m=exec",
                "codex -c 'model_reasoning_effort=high' --search",
                "codex --model='--cd'",
                "codex --yolo",
            ],
        ),
        (
            "claude_code",
            vec![
                "claude --model=resume",
                "claude -nresume",
                "claude --tools ''",
                "claude --allowedTools 'Bash(git *)' Read --model sonnet",
                "claude --debug=mcp --verbose",
            ],
        ),
        (
            "opencode",
            vec![
                "opencode -mprovider/model --agent build",
                "opencode --model=run --print-logs",
            ],
        ),
        (
            "pi",
            vec![
                "pi -nt -ne --model resume",
                "pi -np -nc -nbt --thinking high",
                "pi --extension '/path with spaces/extension.ts'",
            ],
        ),
    ] {
        for command in commands {
            assert!(parse_command(kind, command).is_ok(), "{command}");
        }
    }
    for (kind, executable, args) in [
        (
            "codex",
            "codex",
            vec![
                "-C/tmp",
                "--cd=/tmp",
                "--add-dir /tmp",
                "--worktree",
                "--remote unix://",
                "--image prompt.png",
                "-hV",
                "-mcodex resume",
            ],
        ),
        (
            "claude_code",
            "claude",
            vec![
                "--resume=other",
                "-rother",
                "--session-id other",
                "--print",
                "--append-system-prompt text",
                "-wbranch",
                "--fork-session",
                "--background",
                "--verbose=true",
                "--debug resume",
            ],
        ),
        (
            "opencode",
            "opencode",
            vec![
                "--session=other",
                "-sother",
                "--continue",
                "--prompt task",
                "--fork",
                "--dir /tmp",
                "--mdns resume",
            ],
        ),
        (
            "pi",
            "pi",
            vec![
                "--session-id x",
                "--fork x",
                "--mode rpc",
                "--print",
                "--append-system-prompt x",
                "--export file",
                "--list-models",
                "--model=resume",
                "-nname",
                "-ntp",
            ],
        ),
    ] {
        for args in args {
            assert!(
                parse_command(kind, &format!("{executable} {args}")).is_err(),
                "{kind}: {args}"
            );
        }
    }
}

#[test]
fn codex_config_values_cannot_replace_managed_context() {
    for args in [
        "-c developer_instructions=custom",
        "--config=log_dir=/tmp",
        "-ccwd=/tmp",
        r#"-c '"developer_instructions"=custom'"#,
        "-c 'log_dir.child=1'",
        "-c missing-equals",
    ] {
        assert!(
            parse_command("codex", &format!("codex {args}")).is_err(),
            "{args}"
        );
    }
    for args in [
        "-c 'model=resume'",
        "--model='-cdeveloper_instructions=x'",
        "-mresume --config 'model_reasoning_effort=high'",
    ] {
        assert!(
            parse_command("codex", &format!("codex {args}")).is_ok(),
            "{args}"
        );
    }
}

#[test]
fn launch_always_validates_before_executable_resolution() {
    let context = LaunchContext {
        session_id: "01a08fff908b76b28c1c3826e810b018",
        runtime_dir: None,
        cwd: "/tmp",
        additional_directories: &[],
        initial_prompt: "",
        instructions: None,
        resume_id: None,
        log_dir: None,
    };
    for kind in ["codex", "claude_code", "opencode", "pi"] {
        let command = "/missing/agent --model test resume other";
        let config = AgentSettings {
            command: command.into(),
        };
        let saved_error = parse_command(kind, command).unwrap_err().to_string();
        let launched_error = build_launch(kind, &context, &config)
            .unwrap_err()
            .to_string();
        assert_eq!(saved_error, launched_error);
        assert!(detect_installation(kind, &config).is_none());
    }
}

#[test]
fn launch_preserves_literal_values_and_adds_only_agent_specific_context() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let executable = dir.path().join("agent with spaces");
    std::fs::write(&executable, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    let directories = vec!["/extra directory".into()];
    let context = LaunchContext {
        session_id: "01a08fff908b76b28c1c3826e810b018",
        runtime_dir: None,
        cwd: "/work directory",
        additional_directories: &directories,
        initial_prompt: "--help",
        instructions: Some("Treefold instructions"),
        resume_id: None,
        log_dir: Some(dir.path()),
    };
    let config = AgentSettings {
        command: format!(
            "{} --model 'resume with spaces'",
            shell_words::quote(&executable.to_string_lossy())
        ),
    };
    for kind in ["codex", "claude_code", "opencode", "pi"] {
        let argv = build_launch(kind, &context, &config).unwrap();
        assert_eq!(
            &argv[..3],
            &[
                executable.to_string_lossy().into_owned(),
                "--model".into(),
                "resume with spaces".into()
            ]
        );
        let mut expected = match kind {
            "codex" => vec![
                "--no-daemon".into(),
                "-c".into(),
                hooks::codex_override("SessionStart"),
                "-c".into(),
                hooks::codex_override("UserPromptSubmit"),
                "-C".into(),
                context.cwd.into(),
                "--add-dir".into(),
                directories[0].clone(),
                "--no-alt-screen".into(),
                "-c".into(),
                "developer_instructions=\"Treefold instructions\"".into(),
                "-c".into(),
                format!(
                    "log_dir={}",
                    serde_json::to_string(&dir.path().to_string_lossy()).unwrap()
                ),
            ],
            "claude_code" => vec![
                "--session-id".into(),
                "01a08fff-908b-76b2-8c1c-3826e810b018".into(),
                "--add-dir".into(),
                directories[0].clone(),
                "--append-system-prompt".into(),
                "Treefold instructions".into(),
            ],
            "pi" => vec![
                "--append-system-prompt".into(),
                "Treefold instructions".into(),
            ],
            "opencode" => vec!["--standalone".into()],
            _ => vec![],
        };
        expected.extend([
            if kind == "opencode" { "--prompt" } else { "--" }.into(),
            "--help".into(),
        ]);
        assert_eq!(&argv[3..], expected, "{kind}");
    }
    let resumed = build_launch(
        "codex",
        &LaunchContext {
            session_id: "01a08fff908b76b28c1c3826e810b018",
            runtime_dir: None,
            resume_id: Some("saved-session"),
            ..context
        },
        &config,
    )
    .unwrap();
    assert_eq!(&resumed[resumed.len() - 2..], ["resume", "saved-session"]);
    assert!(!resumed.iter().any(|arg| arg == "--help"));
}

#[test]
fn managed_agents_resume_exactly_without_replaying_the_initial_prompt() {
    let root = tempfile::tempdir().unwrap();
    let context = LaunchContext {
        session_id: "01a08fff908b76b28c1c3826e810b018",
        runtime_dir: Some(root.path()),
        cwd: "/checkout",
        additional_directories: &[],
        initial_prompt: "do not replay",
        instructions: Some("updated context"),
        resume_id: Some("saved-native-id"),
        log_dir: None,
    };
    for (kind, option) in [
        ("claude_code", "--resume"),
        ("opencode", "--session"),
        ("pi", "--session"),
    ] {
        let argv = adapter(kind).unwrap().build_args(&context, &[]).unwrap();
        let expected = if kind == "pi" {
            root.path()
                .join("session.jsonl")
                .to_string_lossy()
                .into_owned()
        } else {
            "saved-native-id".into()
        };
        assert!(
            argv.windows(2)
                .any(|pair| pair == [option, expected.as_str()]),
            "{kind}: {argv:?}"
        );
        assert!(!argv.iter().any(|arg| arg == context.initial_prompt));
    }
}

#[test]
fn pi_history_validates_a_known_id_but_never_discovers_one() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("session.jsonl");
    let native_id = "01a08fff-908b-76b2-8c1c-3826e810b018";
    let mut context = MetadataContext {
        session_id: "managed",
        native_id: None,
        runtime_dir: root.path(),
    };
    std::fs::write(&path, format!("{{\"type\":\"session\",\"id\":\"{native_id}\"}}\n{{\"type\":\"session_info\",\"name\":\"Saved task\"}}\n")).unwrap();
    let metadata = read_metadata("pi", &context);
    assert!(metadata.id.is_none());
    assert!(validate_resume("pi", &context).is_err());
    context.native_id = Some(native_id);
    assert!(validate_resume("pi", &context).is_ok());
    std::fs::remove_file(&path).unwrap();
    assert!(validate_resume("pi", &context).is_err());
    context.native_id = Some("different");
    assert!(read_metadata("pi", &context).id.is_none());
    context.native_id = None;
    assert!(read_metadata("pi", &context).id.is_none());
}

#[test]
fn workflow_agent_selection_uses_configured_order_and_rejects_unavailable_choices() {
    let mut settings = AgentsSettings::default();
    settings.order = vec![
        "pi".into(),
        "opencode".into(),
        "codex".into(),
        "claude_code".into(),
    ];
    settings.pi.command = "/treefold-test-missing-agent".into();
    settings.opencode.command = "/bin/echo".into();
    settings.codex.command = "/bin/echo".into();
    settings.claude_code.command = "/treefold-test-missing-agent".into();
    assert_eq!(select_available(&settings, None).unwrap(), "opencode");
    assert_eq!(select_available(&settings, Some("codex")).unwrap(), "codex");
    assert!(select_available(&settings, Some("pi")).is_err());
    assert!(select_available(&settings, Some("shell")).is_err());
    settings.opencode.command = "/treefold-test-missing-agent".into();
    settings.codex.command = "/treefold-test-missing-agent".into();
    assert!(select_available(&settings, None).is_err());
}

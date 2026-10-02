use crate::model::Session;

pub(crate) fn codex_arguments(
    session: &Session,
    developer_instructions: Option<&str>,
    extra_args: &[String],
) -> Vec<String> {
    let mut arguments = extra_args.to_vec();
    arguments.extend(["-C".into(), session.cwd.clone()]);
    for path in &session.additional_directories {
        arguments.extend(["--add-dir".into(), path.clone()]);
    }
    if !arguments
        .iter()
        .any(|argument| argument == "--no-alt-screen")
    {
        // Treefold already owns the terminal viewport and scrollback. Codex's alternate-screen
        // UI adds a second viewport boundary beside xterm's scrollbar in this embedded context.
        arguments.push("--no-alt-screen".into());
    }
    if let Some(instructions) = developer_instructions {
        let encoded = serde_json::to_string(instructions)
            .expect("serializing developer instructions cannot fail");
        arguments.extend(["-c".into(), format!("developer_instructions={encoded}")]);
    }
    if let Some(codex_id) = &session.codex_session_id {
        arguments.extend(["resume".into(), codex_id.clone()]);
    } else if !session.initial_prompt.is_empty() {
        arguments.push(session.initial_prompt.clone());
    }
    arguments
}

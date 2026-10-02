use anyhow::{Context, Result, bail};

/// Parse one executable and its arguments, without invoking a shell.
pub(super) fn parse(text: &str) -> Result<(String, Vec<String>)> {
    let mut quote = None;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if quote == Some('\'') {
            if ch == '\'' {
                quote = None;
            }
            continue;
        }
        if ch == '\\' {
            chars.next();
            continue;
        }
        if ch == '"' {
            quote = if quote == Some('"') { None } else { Some('"') };
            continue;
        }
        if quote.is_none() && ch == '\'' {
            quote = Some('\'');
            continue;
        }
        if ch == '\0' {
            bail!("Invalid Agent command: NUL is not allowed");
        }
        if (quote.is_none() && "|&;<>()\n\r".contains(ch))
            || ch == '`'
            || (ch == '$' && matches!(chars.peek(), Some('(' | '{')))
        {
            bail!(
                "Enter a single Agent CLI command; shell operators and substitutions are not supported"
            );
        }
    }
    if text.contains('\0') {
        bail!("Invalid Agent command: NUL is not allowed");
    }
    let mut words = shell_words::split(text)
        .context("Invalid Agent command: check quotes and escapes")?
        .into_iter();
    let executable = words
        .next()
        .context("Agent command must include an executable")?;
    if executable.is_empty() || executable.starts_with('-') {
        bail!("Agent command must start with an executable, followed by its arguments");
    }
    if executable.contains('=') && !executable.contains('/') {
        bail!(
            "Agent command must start with an executable; environment assignments are not supported"
        );
    }
    Ok((executable, words.collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoted_paths_and_arguments_remain_literal() {
        assert_eq!(
            parse(
                r#""/path with spaces/codex" --model 'a b' --value '$HOME;$(echo x)' --value "a|b""#
            )
            .unwrap(),
            (
                "/path with spaces/codex".into(),
                vec![
                    "--model".into(),
                    "a b".into(),
                    "--value".into(),
                    "$HOME;$(echo x)".into(),
                    "--value".into(),
                    "a|b".into()
                ]
            )
        );
    }

    #[test]
    fn rejects_shell_syntax_and_arguments_without_executable() {
        for text in [
            "codex|cat",
            "codex && pi",
            "codex > out",
            "codex;pi",
            "codex\npi",
            "codex $(whoami)",
            "codex `whoami`",
            "codex \"$(whoami)\"",
            "MODEL=x codex",
            "--model x",
            "'' --model x",
            "codex 'unfinished",
            "codex\0",
        ] {
            assert!(parse(text).is_err(), "{text:?}");
        }
    }
}

use super::{AppError, Result, denied};
use crate::{git, model::RewordPreview};
use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

pub(super) fn output(path: &str, args: &[&str]) -> Result<String> {
    git::output(Path::new(path), args).map_err(AppError::BadRequest)
}

pub(super) fn preview(path: &str, expected: &str) -> Result<RewordPreview> {
    if !matches!(expected.len(), 40 | 64) || !expected.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(denied("REWORD_STALE", "Select the current HEAD commit"));
    }
    let branch = output(path, &["symbolic-ref", "--quiet", "HEAD"]).map_err(|_| {
        denied(
            "REWORD_BRANCH",
            "Check out a local branch before editing a commit",
        )
    })?;
    if output(path, &["rev-parse", "HEAD"])? != expected {
        return Err(denied("REWORD_STALE", "HEAD changed; reopen the editor"));
    }
    if super::super::git_operation_in_progress(path)?
        || !output(path, &["ls-files", "--unmerged"])?.is_empty()
    {
        return Err(denied(
            "REWORD_OPERATION",
            "Finish the current Git operation first",
        ));
    }
    if !output(
        path,
        &["for-each-ref", "--format=%(refname)", "refs/replace"],
    )?
    .is_empty()
    {
        return Err(denied(
            "REWORD_REPLACE",
            "Remove Git replacement objects before editing a commit",
        ));
    }
    let raw = Command::new("git")
        .current_dir(path)
        .args(["cat-file", "commit", expected])
        .output()
        .map_err(anyhow::Error::from)?;
    if !raw.status.success() {
        return Err(AppError::BadRequest(
            String::from_utf8_lossy(&raw.stderr).into(),
        ));
    }
    let raw = String::from_utf8(raw.stdout).map_err(|_| {
        denied(
            "REWORD_ENCODING",
            "Only UTF-8 commit messages can be edited",
        )
    })?;
    let (_, message) = raw
        .split_once("\n\n")
        .ok_or_else(|| denied("REWORD_ENCODING", "Invalid commit object"))?;
    if message
        .lines()
        .any(|line| line.trim_start().starts_with("Treefold-Squash:"))
    {
        return Err(denied(
            "REWORD_DELIVERY",
            "This commit contains a Treefold delivery marker",
        ));
    }
    let refs = output(
        path,
        &[
            "for-each-ref",
            &format!("--contains={expected}"),
            "--format=%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    Ok(RewordPreview {
        head: expected.into(),
        branch: branch.clone(),
        message: message.into(),
        shared_refs: refs
            .lines()
            .filter(|reference| *reference != branch)
            .map(str::to_owned)
            .collect(),
    })
}

pub(super) fn apply(
    path: &str,
    expected: &str,
    branch: &str,
    message: &str,
    confirmed_refs: &[String],
) -> Result<String> {
    if message.trim().is_empty()
        || message.contains('\0')
        || message
            .lines()
            .any(|line| line.trim_start().starts_with("Treefold-Squash:"))
    {
        return Err(denied(
            "REWORD_MESSAGE",
            "Enter a non-empty message without a Treefold delivery marker",
        ));
    }
    let before = preview(path, expected)?;
    if before.branch != branch {
        return Err(denied(
            "REWORD_STALE",
            "Repository branch changed; reopen the editor",
        ));
    }
    if before
        .shared_refs
        .iter()
        .any(|reference| !confirmed_refs.contains(reference))
    {
        return Err(denied(
            "REWORD_CONFIRM",
            "References changed; reopen the editor and confirm the warning",
        ));
    }
    if before.message.trim_end() == message.trim_end() {
        return Ok(expected.into());
    }
    // Build from the committed tree, not the index. All parents (including merge
    // parents) and the author are retained. Explicitly honor commit.gpgsign;
    // commit hooks are not run for this message-only rewrite.
    let tree = output(path, &["show", "-s", "--format=%T", expected])?;
    let parents = output(path, &["show", "-s", "--format=%P", expected])?;
    let author = output(
        path,
        &["show", "-s", "--format=%an%x00%ae%x00%aI", expected],
    )?;
    let author: Vec<_> = author.split('\0').collect();
    if author.len() != 3 {
        return Err(denied("REWORD_ENCODING", "Invalid commit author"));
    }
    let mut command = Command::new("git");
    command.current_dir(path).args(["commit-tree", &tree]);
    let signing = Command::new("git")
        .current_dir(path)
        .args(["config", "--type=bool", "--get", "commit.gpgsign"])
        .output()
        .map_err(anyhow::Error::from)?;
    if signing.status.success() {
        if String::from_utf8_lossy(&signing.stdout).trim() == "true" {
            command.arg("-S");
        }
    } else if signing.status.code() != Some(1) {
        return Err(AppError::BadRequest(
            String::from_utf8_lossy(&signing.stderr).trim().into(),
        ));
    }
    for parent in parents.split_whitespace() {
        command.args(["-p", parent]);
    }
    let mut child = command
        .env("GIT_AUTHOR_NAME", author[0])
        .env("GIT_AUTHOR_EMAIL", author[1])
        .env("GIT_AUTHOR_DATE", author[2])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(anyhow::Error::from)?;
    let write_result = child
        .stdin
        .take()
        .unwrap()
        .write_all(format!("{}\n", message.trim_end()).as_bytes());
    let result = child.wait_with_output().map_err(anyhow::Error::from)?;
    write_result.map_err(anyhow::Error::from)?;
    if !result.status.success() {
        return Err(AppError::BadRequest(
            String::from_utf8_lossy(&result.stderr).trim().into(),
        ));
    }
    let head = String::from_utf8_lossy(&result.stdout).trim().to_owned();
    let rechecked = preview(path, expected)?;
    if rechecked.branch != branch {
        return Err(denied(
            "REWORD_STALE",
            "Repository branch changed; reopen the editor",
        ));
    }
    if rechecked
        .shared_refs
        .iter()
        .any(|reference| !confirmed_refs.contains(reference))
    {
        return Err(denied(
            "REWORD_CONFIRM",
            "References changed; reopen the editor",
        ));
    }
    output(
        path,
        &[
            "update-ref",
            "--create-reflog",
            "-m",
            "Treefold: edit commit message",
            branch,
            &head,
            expected,
        ],
    )?;
    Ok(head)
}

# AI Commit

AI Commit fills an editable commit message in Changes, Git History Squash, and
Workspace/Fork squash delivery. It never stages files, commits, or delivers code.

## Configuration

Open **Settings → Agents → AI Commit**, or **Go to settings** beside a commit
message. Squash delivery has one shared **AI Commit settings** button next to
the section title. Selecting a command preset immediately fills the command field. Only
installed, available Agents appear in the preset menu. The saved command is the
source of truth; there is no separate Agent or model selection for AI Commit.

Presets reuse the executable from the Agent's saved command, without its
interactive Session arguments. They do not pin a model; the CLI's own defaults
apply. Codex, Claude Code, and Pi request low reasoning/effort. Commands can be
edited or replaced with a custom script.

**Test generation** runs the current, unsaved command against a small synthetic
diff. A successful test shows its output and a green check. Editing the command
clears the result. Testing is optional: failures do not prevent saving.

The independent **Automatically generate commit messages** switch defaults to
off. With it off, a configured command remains available through the **AI Commit**
button. With it on, an editor generates once when its context becomes ready,
provided its draft is empty or still the template. Handwritten drafts are kept.
Refreshing Git data does not automatically retry a failed generation.

Preferences use the existing settings resource and
`$TREEFOLD_HOME/config/settings.toml`:

```toml
[ai_commit]
command = "codex exec --ephemeral --skip-git-repo-check --sandbox read-only -c model_reasoning_effort=low -"
automatic = false
```

Omitted values default to an empty command and `automatic = false`.

## Generation behavior

Treefold supplies a prompt on stdin and reads the commit message from stdout.
Commands run through `/bin/sh -c` in a temporary directory, using the application's
PATH and the CLI's existing login/configuration. Shell aliases and functions are
not loaded. Use an executable path or script for custom wrappers. OpenCode's
JSON text events are also accepted. Treefold sends the relevant changes directly;
the command does not need to run Git or inspect the repository itself.

- **Changes:** staged diff only, excluding unstaged and untracked content.
- **Git History Squash:** the selected consecutive commit range.
- **Squash delivery:** committed source changes since the merge base with the
  current delivery target, separately for each repository.

The prompt includes branch, file statistics, and recent commit subjects for
style. Diffs are bounded, with smaller excerpts for lockfiles and minified files.
Large inputs may be truncated. Generated output must be nonempty and at most
32 KiB. Git HEAD/index changes during generation, or movement of the delivery
target, invalidate the result.

Up to three jobs run concurrently; extra repositories wait. Each running job has
a 60-second deadline, excluding queue time. The cancel button, editing the draft,
or closing/replacing its editor stops generation and terminates its process
group. Late results cannot replace the current draft. Failures and timeouts keep
the existing message, or restore the template when it is empty. Generation can
be triggered again manually, and the resulting text remains editable before the
usual Commit/Squash confirmation.

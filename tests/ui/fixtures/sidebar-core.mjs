export const FIXTURE_IDS = Object.freeze({
  project: "project-ui-fixture",
  primaryDirectory: "directory-primary-ui-fixture",
  attachedDirectory: "directory-attached-ui-fixture",
  workstream: "workstream-ui-fixture",
  fork: "fork-ui-fixture",
  archivedFork: "fork-archived-ui-fixture",
  workstreamShell: "session-workstream-shell-ui-fixture",
  workstreamCodex: "session-workstream-codex-ui-fixture",
  forkShell: "session-fork-shell-ui-fixture",
});

export const FIXTURE_NAMES = Object.freeze({
  project: "UI Fixture Project",
  workstream: "Workstream with an intentionally long name for sidebar layout verification",
  fork: "Fork with an intentionally long name that must preserve its action button",
  archivedFork: "Archived Fork that must stay out of the active sidebar tree",
});

export const FIXTURE_COMMITS = Object.freeze([
  {
    hash: "f5377ee1234567890abcdef1234567890abcdef1",
    short_hash: "f5377ee",
    subject: "Replace Makefile with Justfile",
    author: "win5do",
    authored_at: "2026-08-07T11:17:00+08:00",
  },
  {
    hash: "3cddb0b1234567890abcdef1234567890abcdef1",
    short_hash: "3cddb0b",
    subject: "Reimplement amux runtime in Rust",
    author: "win5do",
    authored_at: "2026-08-07T10:42:00+08:00",
  },
]);

const timestamp = "2026-08-10T08:00:00.000Z";
const primaryPath = "/tmp/treefold-ui-fixture/repository-with-a-long-readable-path";
const attachedPath = "/tmp/treefold-ui-fixture/attached-documentation";
const workstreamPath = "/tmp/treefold-ui-fixture/worktrees/workstream-ui-fixture";
const forkPath = "/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture";

const project = {
  id: FIXTURE_IDS.project,
  name: FIXTURE_NAMES.project,
  description: "Deterministic data used only by the Treefold UI core test.",
  status: "active",
  primary_directory_id: FIXTURE_IDS.primaryDirectory,
  base_branch: "main",
  created_at: timestamp,
  updated_at: timestamp,
};

const directories = [
  {
    id: FIXTURE_IDS.primaryDirectory,
    project_id: FIXTURE_IDS.project,
    name: "fixture-repository",
    description: "Primary Git repository",
    worktree_setup_command: "",
    path: primaryPath,
    role: "primary",
    is_git: true,
    remote_url: "https://example.test/treefold/ui-fixture.git",
    branch: "main",
    head_commit: "0123456789",
    head_summary: "Deterministic fixture commit",
    dirty: false,
    created_at: timestamp,
  },
  {
    id: FIXTURE_IDS.attachedDirectory,
    project_id: FIXTURE_IDS.project,
    name: "fixture-documentation",
    description: "Attached non-Git reference directory",
    worktree_setup_command: "",
    path: attachedPath,
    role: "attached",
    is_git: false,
    dirty: false,
    created_at: timestamp,
  },
];

function session({ id, workstreamId, name, kind, cwd, status, codexSessionId }) {
  return {
    id,
    workstream_id: workstreamId,
    name,
    kind,
    cwd,
    original_cwd: cwd,
    initial_prompt: kind === "codex" ? "Verify the deterministic UI fixture." : "",
    codex_session_id: codexSessionId,
    yolo: false,
    sidebar_visible: true,
    process_id: id,
    process_name: `${kind}-fixture`,
    status,
    pid: 0,
    process_group_id: 0,
    exit_code: status === "exited" ? 0 : undefined,
    exit_signal: "",
    command: kind === "codex" ? ["codex", "resume", codexSessionId] : ["/bin/zsh"],
    launch_started_at: timestamp,
    last_attached_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    additional_directories: [attachedPath],
  };
}

const workstream = {
  id: FIXTURE_IDS.workstream,
  project_id: FIXTURE_IDS.project,
  name: FIXTURE_NAMES.workstream,
  description: "Parent Workstream for the deterministic sidebar flow.",
  status: "active",
  kind: "workstream",
  parent_workstream_id: null,
  workspace_mode: "worktree",
  project_directory_id: FIXTURE_IDS.primaryDirectory,
  worktree_id: null,
  workspace_path: workstreamPath,
  base_ref: "main",
  base_commit: "0123456789abcdef",
  branch: "treefold/w-ui-fixture",
  forked_from_commit: null,
  integration_status: "none",
  close_outcome: null,
  integrated_commit: null,
  closed_at: null,
  runtime_id: FIXTURE_IDS.workstream,
  runtime_name: "treefold-workstream-ui-fixture",
  created_at: timestamp,
  updated_at: timestamp,
};

const fork = {
  ...workstream,
  id: FIXTURE_IDS.fork,
  name: FIXTURE_NAMES.fork,
  description: "Active Fork with a long label.",
  kind: "fork",
  parent_workstream_id: FIXTURE_IDS.workstream,
  workspace_path: forkPath,
  branch: "treefold/f-ui-fixture",
  forked_from_commit: "0123456789abcdef",
  integration_status: "pending",
  runtime_id: FIXTURE_IDS.fork,
  runtime_name: "treefold-fork-ui-fixture",
};

const archivedFork = {
  ...fork,
  id: FIXTURE_IDS.archivedFork,
  name: FIXTURE_NAMES.archivedFork,
  status: "archived",
  workspace_path: "/tmp/treefold-ui-fixture/worktrees/archived-fork-ui-fixture",
  branch: "treefold/f-archived-ui-fixture",
  integration_status: "discarded",
  close_outcome: "discarded",
  closed_at: timestamp,
  runtime_id: FIXTURE_IDS.archivedFork,
  runtime_name: "treefold-archived-fork-ui-fixture",
};

const workstreamSessions = [
  session({
    id: FIXTURE_IDS.workstreamShell,
    workstreamId: FIXTURE_IDS.workstream,
    name: "Parent Shell Session",
    kind: "shell",
    cwd: workstreamPath,
    status: "running",
  }),
  session({
    id: FIXTURE_IDS.workstreamCodex,
    workstreamId: FIXTURE_IDS.workstream,
    name: "Parent Codex Session with a deliberately long resumable label",
    kind: "codex",
    cwd: workstreamPath,
    status: "exited",
    codexSessionId: "codex-ui-fixture-session",
  }),
];

const forkSessions = [
  session({
    id: FIXTURE_IDS.forkShell,
    workstreamId: FIXTURE_IDS.fork,
    name: "Fork Shell Session",
    kind: "shell",
    cwd: forkPath,
    status: "running",
  }),
];

const workstreamTodos = [
  {
    id: "todo-pending-ui-fixture",
    workstream_id: FIXTURE_IDS.workstream,
    title: "Pending deterministic Todo",
    description: "Remains pending for UI coverage.",
    status: "pending",
  },
  {
    id: "todo-done-ui-fixture",
    workstream_id: FIXTURE_IDS.workstream,
    title: "Completed deterministic Todo",
    description: "Remains in history for UI coverage.",
    status: "done",
  },
];

const workstreamDetail = {
  ...workstream,
  project,
  directories,
  sessions: workstreamSessions,
  todos: workstreamTodos,
  forks: [fork, archivedFork],
};

const forkDetail = {
  ...fork,
  project,
  directories: directories.map((directory) => directory.id === FIXTURE_IDS.primaryDirectory ? { ...directory, workspace_path: forkPath } : directory),
  sessions: forkSessions,
  todos: [],
  forks: [],
};

const projectDetail = {
  ...project,
  directories,
  workstreams: [workstream, fork, archivedFork],
  worktrees: [
    {
      directory_id: FIXTURE_IDS.primaryDirectory,
      directory_name: "fixture-repository",
      path: primaryPath,
      branch: "main",
      head_commit: "0123456789",
      is_main: true,
    },
    {
      directory_id: FIXTURE_IDS.primaryDirectory,
      directory_name: "fixture-repository",
      path: workstreamPath,
      branch: workstream.branch,
      head_commit: "0123456789",
      is_main: false,
      workstream_id: FIXTURE_IDS.workstream,
      workstream_name: FIXTURE_NAMES.workstream,
    },
    {
      directory_id: FIXTURE_IDS.primaryDirectory,
      directory_name: "fixture-repository",
      path: forkPath,
      branch: fork.branch,
      head_commit: "0123456789",
      is_main: false,
      workstream_id: FIXTURE_IDS.fork,
      workstream_name: FIXTURE_NAMES.fork,
    },
  ],
  todos: [],
  sessions: [],
};

const settlementPreflight = {
  id: "settlement-preflight-ui-fixture",
  workstream_id: FIXTURE_IDS.fork,
  code_action: "merge",
  source_head: "abcdef1234567890abcdef1234567890abcdef12",
  target_head: "0123456789abcdef0123456789abcdef01234567",
  target_branch: workstream.branch,
  source_status: "",
  source_dirty: false,
  target_dirty: false,
  ahead: 2,
  behind: 1,
  changed_files: ["src/App.tsx", "src-tauri/src/server.rs"],
  commits: FIXTURE_COMMITS,
  diff_stat: "2 files changed, 24 insertions(+)",
  blockers: [],
  warnings: ["source is 1 commit(s) behind its merge target"],
  created_at: timestamp,
};

const gitOperations = [
  {
    id: "reset-operation-ui-fixture",
    kind: "reset",
    action: "parent",
    status: "restored",
    before_head: "abcdef1234567890abcdef1234567890abcdef12",
    target_head: "0123456789abcdef0123456789abcdef01234567",
    result_head: "0123456789abcdef0123456789abcdef01234567",
    recovery_ref: "refs/treefold/recovery/reset-ui-fixture",
    error: "",
    started_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: "rebase-operation-ui-fixture",
    kind: "rebase",
    action: "onto_parent",
    status: "completed",
    before_head: "1111111111111111111111111111111111111111",
    target_head: "2222222222222222222222222222222222222222",
    result_head: "3333333333333333333333333333333333333333",
    recovery_ref: "refs/treefold/recovery/rebase-ui-fixture",
    error: "",
    started_at: "2026-08-09T08:00:00.000Z",
    updated_at: "2026-08-09T08:01:00.000Z",
  },
];

export function createSidebarCoreFixture() {
  return structuredClone({
    settings: {
      schema_version: 1,
      language: "en-US",
      worktree_root: "/fixture/treefold/worktrees",
      agents: {
        codex: {
          extra_args: [
            "--dangerously-bypass-approvals-and-sandbox",
            "--model",
            "gpt-5.4",
          ],
        },
      },
    },
    system: {
      platform: "test",
      codex_available: true,
      codex_version: "codex-ui-fixture",
      backend: "fixture",
      terminal_runtime: "fixture",
    },
    projects: [project],
    projectDetails: { [FIXTURE_IDS.project]: projectDetail },
    workstreamDetails: {
      [FIXTURE_IDS.workstream]: workstreamDetail,
      [FIXTURE_IDS.fork]: forkDetail,
    },
    gitHistories: {
      [FIXTURE_IDS.project]: { branch: "main", commits: FIXTURE_COMMITS },
      [FIXTURE_IDS.workstream]: { branch: workstream.branch, commits: FIXTURE_COMMITS },
      [FIXTURE_IDS.fork]: { branch: fork.branch, commits: FIXTURE_COMMITS },
    },
    settlementPreflights: { [FIXTURE_IDS.fork]: settlementPreflight },
    gitOperations: { [FIXTURE_IDS.fork]: gitOperations },
  });
}

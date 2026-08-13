export const FIXTURE_IDS = Object.freeze({
  project: "project-ui-fixture",
  primaryDirectory: "directory-primary-ui-fixture",
  attachedDirectory: "directory-attached-ui-fixture",
  secondaryDirectory: "directory-secondary-ui-fixture",
  workspace: "workspace-ui-fixture",
  fork: "fork-ui-fixture",
  archivedFork: "fork-archived-ui-fixture",
  workspaceShell: "session-workspace-shell-ui-fixture",
  workspaceCodex: "session-workspace-codex-ui-fixture",
  forkShell: "session-fork-shell-ui-fixture",
  projectCodex: "session-project-codex-ui-fixture",
  workspacePrimaryLocation: "workspace-location-primary-ui-fixture",
  workspaceSecondaryLocation: "workspace-location-secondary-ui-fixture",
  workspaceReadonlyLocation: "workspace-location-readonly-ui-fixture",
  forkPrimaryLocation: "fork-location-primary-ui-fixture",
  forkSecondaryLocation: "fork-location-secondary-ui-fixture",
  forkReadonlyLocation: "fork-location-readonly-ui-fixture",
});

export const FIXTURE_NAMES = Object.freeze({
  project: "UI Fixture Project",
  workspace: "Workspace with an intentionally long name for sidebar layout verification",
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
const secondaryPath = "/tmp/treefold-ui-fixture/secondary-api-repository";
const workspacePath = "/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture";
const secondaryWorkspacePath = "/tmp/treefold-ui-fixture/worktrees/workspace-ui-fixture-api";
const forkPath = "/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture";
const secondaryForkPath = "/tmp/treefold-ui-fixture/worktrees/fork-ui-fixture-api";

const project = {
  id: FIXTURE_IDS.project,
  name: FIXTURE_NAMES.project,
  description: "Deterministic data used only by the Treefold UI core test.",
  status: "active",
  default_location_id: FIXTURE_IDS.primaryDirectory,
  default_base_branch: "main",
  primary_directory_id: FIXTURE_IDS.primaryDirectory,
  git_common_dir: `${primaryPath}/.git`,
  preferred_remote: "origin",
  default_target_branch: "main",
  default_delivery_mode: "remote_review",
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
    repository_url: "https://example.test/treefold/ui-fixture.git",
    preferred_remote_name: "origin",
    base_branch: "main",
    delivery_mode: "remote_review",
    git_common_dir: `${primaryPath}/.git`,
    git_status: "ready",
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
    git_status: "not_git",
    role: "attached",
    is_git: false,
    dirty: false,
    created_at: timestamp,
  },
  {
    id: FIXTURE_IDS.secondaryDirectory,
    project_id: FIXTURE_IDS.project,
    name: "fixture-api-repository",
    description: "Secondary Git repository",
    worktree_setup_command: "",
    path: secondaryPath,
    repository_url: "https://example.test/treefold/ui-fixture-api.git",
    preferred_remote_name: "origin",
    base_branch: "develop",
    delivery_mode: "local_merge",
    git_common_dir: `${secondaryPath}/.git`,
    git_status: "ready",
    role: "attached",
    is_git: true,
    remote_url: "https://example.test/treefold/ui-fixture-api.git",
    branch: "release/api-fixture",
    head_commit: "abcdef0123456789",
    head_summary: "Secondary fixture commit",
    dirty: false,
    created_at: timestamp,
  },
];

function session({ id, workspaceId, name, kind, cwd, status, codexSessionId, sidebarVisible = true }) {
  return {
    id,
    workspace_id: workspaceId,
    name,
    kind,
    cwd,
    original_cwd: cwd,
    initial_prompt: kind === "codex" ? "Verify the deterministic UI fixture." : "",
    codex_session_id: codexSessionId,
    yolo: false,
    sidebar_visible: sidebarVisible,
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

const projectSessions = [
  session({
    id: FIXTURE_IDS.projectCodex,
    workspaceId: `project-base-${FIXTURE_IDS.project}`,
    name: "Saved Project Codex Session",
    kind: "codex",
    cwd: primaryPath,
    status: "exited",
    codexSessionId: "codex-project-ui-fixture-session",
    sidebarVisible: false,
  }),
];

const workspace = {
  id: FIXTURE_IDS.workspace,
  project_id: FIXTURE_IDS.project,
  name: FIXTURE_NAMES.workspace,
  description: "Parent Workspace for the deterministic sidebar flow.",
  status: "active",
  kind: "workspace",
  parent_workspace_id: null,
  checkout_mode: "worktree",
  project_directory_id: FIXTURE_IDS.primaryDirectory,
  worktree_id: null,
  checkout_path: workspacePath,
  target_branch: "main",
  start_commit: "0123456789abcdef",
  branch: "treefold/w-ui-fixture",
  forked_from_commit: null,
  remote_name: "origin",
  remote_branch: "feature/ui-fixture",
  branch_ownership: "managed",
  delivery_mode: "remote_review",
  delivery_status: "published",
  close_outcome: null,
  integrated_commit: null,
  closed_at: null,
  runtime_id: FIXTURE_IDS.workspace,
  runtime_name: "treefold-workspace-ui-fixture",
  created_at: timestamp,
  updated_at: timestamp,
};

const fork = {
  ...workspace,
  id: FIXTURE_IDS.fork,
  name: FIXTURE_NAMES.fork,
  description: "Active Fork with a long label.",
  kind: "fork",
  parent_workspace_id: FIXTURE_IDS.workspace,
  checkout_path: forkPath,
  target_branch: workspace.branch,
  branch: "treefold/f-ui-fixture",
  forked_from_commit: "0123456789abcdef",
  remote_name: undefined,
  remote_branch: undefined,
  delivery_mode: "local_merge",
  delivery_status: "active",
  runtime_id: FIXTURE_IDS.fork,
  runtime_name: "treefold-fork-ui-fixture",
};

const archivedFork = {
  ...fork,
  id: FIXTURE_IDS.archivedFork,
  name: FIXTURE_NAMES.archivedFork,
  status: "archived",
  checkout_path: "/tmp/treefold-ui-fixture/worktrees/archived-fork-ui-fixture",
  branch: "treefold/f-archived-ui-fixture",
  delivery_status: "discarded",
  close_outcome: "discarded",
  closed_at: timestamp,
  runtime_id: FIXTURE_IDS.archivedFork,
  runtime_name: "treefold-archived-fork-ui-fixture",
};

const workspaceSessions = [
  session({
    id: FIXTURE_IDS.workspaceShell,
    workspaceId: FIXTURE_IDS.workspace,
    name: "Parent Shell Session",
    kind: "shell",
    cwd: workspacePath,
    status: "running",
  }),
  session({
    id: FIXTURE_IDS.workspaceCodex,
    workspaceId: FIXTURE_IDS.workspace,
    name: "Parent Codex Session with a deliberately long resumable label",
    kind: "codex",
    cwd: workspacePath,
    status: "exited",
    codexSessionId: "codex-ui-fixture-session",
  }),
];

const forkSessions = [
  session({
    id: FIXTURE_IDS.forkShell,
    workspaceId: FIXTURE_IDS.fork,
    name: "Fork Shell Session",
    kind: "shell",
    cwd: forkPath,
    status: "running",
  }),
];

const workspaceTodos = [
  {
    id: "todo-pending-ui-fixture",
    workspace_id: FIXTURE_IDS.workspace,
    title: "Pending deterministic Todo",
    description: "Remains pending for UI coverage.",
    status: "pending",
  },
  {
    id: "todo-done-ui-fixture",
    workspace_id: FIXTURE_IDS.workspace,
    title: "Completed deterministic Todo",
    description: "Remains in history for UI coverage.",
    status: "done",
  },
];

const workspaceDetail = {
  ...workspace,
  project,
  directories: directories.map((directory) => directory.id === FIXTURE_IDS.primaryDirectory ? { ...directory, checkout_path: workspacePath } : directory.id === FIXTURE_IDS.secondaryDirectory ? { ...directory, checkout_path: secondaryWorkspacePath } : directory),
  locations: [
    { id: FIXTURE_IDS.workspacePrimaryLocation, workspace_id: FIXTURE_IDS.workspace, project_location_id: FIXTURE_IDS.primaryDirectory, location_name: "fixture-repository", source_path: primaryPath, access_mode: "read_write", git_status: "ready", checkout_path: workspacePath, branch: workspace.branch, base_branch: "main", start_commit: workspace.start_commit, remote_name: "origin", remote_branch: "feature/ui-fixture", delivery_mode: "remote_review", delivery_status: "active" },
    { id: FIXTURE_IDS.workspaceSecondaryLocation, workspace_id: FIXTURE_IDS.workspace, project_location_id: FIXTURE_IDS.secondaryDirectory, location_name: "fixture-api-repository", source_path: secondaryPath, access_mode: "read_write", git_status: "ready", checkout_path: secondaryWorkspacePath, branch: workspace.branch, base_branch: "develop", start_commit: workspace.start_commit, remote_name: "origin", remote_branch: "feature/ui-fixture", delivery_mode: "local_merge", delivery_status: "active" },
    { id: FIXTURE_IDS.workspaceReadonlyLocation, workspace_id: FIXTURE_IDS.workspace, project_location_id: FIXTURE_IDS.attachedDirectory, location_name: "fixture-documentation", source_path: attachedPath, access_mode: "read_only", git_status: "not_git", delivery_mode: "keep", delivery_status: "not_applicable" },
  ],
  sessions: workspaceSessions,
  todos: workspaceTodos,
  forks: [fork, archivedFork],
};

const forkDetail = {
  ...fork,
  project,
  directories: directories.map((directory) => directory.id === FIXTURE_IDS.primaryDirectory ? { ...directory, checkout_path: forkPath } : directory.id === FIXTURE_IDS.secondaryDirectory ? { ...directory, checkout_path: secondaryForkPath } : directory),
  locations: [
    { id: FIXTURE_IDS.forkPrimaryLocation, workspace_id: FIXTURE_IDS.fork, project_location_id: FIXTURE_IDS.primaryDirectory, location_name: "fixture-repository", source_path: primaryPath, access_mode: "read_write", git_status: "ready", checkout_path: forkPath, branch: fork.branch, base_branch: workspace.branch, start_commit: fork.start_commit, delivery_mode: "local_merge", delivery_status: "active" },
    { id: FIXTURE_IDS.forkSecondaryLocation, workspace_id: FIXTURE_IDS.fork, project_location_id: FIXTURE_IDS.secondaryDirectory, location_name: "fixture-api-repository", source_path: secondaryPath, access_mode: "read_write", git_status: "ready", checkout_path: secondaryForkPath, branch: fork.branch, base_branch: workspace.branch, start_commit: fork.start_commit, delivery_mode: "local_merge", delivery_status: "active" },
    { id: FIXTURE_IDS.forkReadonlyLocation, workspace_id: FIXTURE_IDS.fork, project_location_id: FIXTURE_IDS.attachedDirectory, location_name: "fixture-documentation", source_path: attachedPath, access_mode: "read_only", git_status: "not_git", delivery_mode: "keep", delivery_status: "not_applicable" },
  ],
  sessions: forkSessions,
  todos: [],
  forks: [],
};

const projectDetail = {
  ...project,
  directories,
  locations: directories,
  sessions: projectSessions,
  workspaces: [workspace, fork, archivedFork],
  worktrees: [
    {
      project_location_id: FIXTURE_IDS.primaryDirectory,
      location_name: "fixture-repository",
      path: primaryPath,
      branch: "main",
      head_commit: "0123456789",
      is_main: true,
    },
    {
      project_location_id: FIXTURE_IDS.primaryDirectory,
      location_name: "fixture-repository",
      path: workspacePath,
      branch: workspace.branch,
      head_commit: "0123456789",
      is_main: false,
      workspace_id: FIXTURE_IDS.workspace,
      workspace_name: FIXTURE_NAMES.workspace,
    },
    {
      project_location_id: FIXTURE_IDS.primaryDirectory,
      location_name: "fixture-repository",
      path: forkPath,
      branch: fork.branch,
      head_commit: "0123456789",
      is_main: false,
      workspace_id: FIXTURE_IDS.fork,
      workspace_name: FIXTURE_NAMES.fork,
    },
    {
      project_location_id: FIXTURE_IDS.secondaryDirectory,
      location_name: "fixture-api-repository",
      path: secondaryPath,
      branch: "release/api-fixture",
      head_commit: "abcdef0123456789",
      is_main: true,
    },
    {
      project_location_id: FIXTURE_IDS.secondaryDirectory,
      location_name: "fixture-api-repository",
      path: secondaryWorkspacePath,
      branch: "treefold/w-ui-fixture-api",
      head_commit: "abcdef0123456789",
      is_main: false,
      workspace_id: FIXTURE_IDS.workspace,
      workspace_name: FIXTURE_NAMES.workspace,
    },
  ],
};

const deliveryPreflight = {
  id: "delivery-preflight-ui-fixture",
  workspace_id: FIXTURE_IDS.fork,
  workspace_location_id: FIXTURE_IDS.forkPrimaryLocation,
  code_action: "local_merge",
  source_head: "abcdef1234567890abcdef1234567890abcdef12",
  target_head: "0123456789abcdef0123456789abcdef01234567",
  target_branch: workspace.branch,
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
    workspaceDetails: {
      [FIXTURE_IDS.workspace]: workspaceDetail,
      [FIXTURE_IDS.fork]: forkDetail,
    },
    gitHistories: {
      [FIXTURE_IDS.project]: { branch: "main", commits: FIXTURE_COMMITS },
      [FIXTURE_IDS.workspace]: { branch: workspace.branch, commits: FIXTURE_COMMITS },
      [FIXTURE_IDS.fork]: { branch: fork.branch, commits: FIXTURE_COMMITS },
    },
    deliveryPreflights: { [FIXTURE_IDS.workspacePrimaryLocation]: { ...deliveryPreflight, id: "delivery-preflight-workspace-ui-fixture", workspace_id: FIXTURE_IDS.workspace, workspace_location_id: FIXTURE_IDS.workspacePrimaryLocation, code_action: "remote_merged", target_branch: "main" }, [FIXTURE_IDS.forkPrimaryLocation]: deliveryPreflight },
    gitOperations: { [FIXTURE_IDS.fork]: gitOperations },
  });
}

export const FIXTURE_IDS = Object.freeze({
  project: "project-ui-fixture",
  directory: "directory-ui-fixture",
  workspace: "workspace-ui-fixture",
  shell: "session-shell-ui-fixture",
});

export const FIXTURE_NAMES = Object.freeze({
  project: "UI Fixture Project",
  workspace: "Feature workspace with a readable long name",
});

const timestamp = "2026-08-13T08:00:00.000Z";
const sourcePath = "/tmp/treefold-ui-fixture/repository";
const workspacePath = "/tmp/treefold-ui-fixture/worktrees/feature";

const project = {
  id: FIXTURE_IDS.project,
  name: FIXTURE_NAMES.project,
  description: "Repository metadata fixture",
  status: "active",
  primary_directory_id: FIXTURE_IDS.directory,
  git_common_dir: "/tmp/treefold-ui-fixture/repository/.git",
  preferred_remote: "origin",
  default_target_branch: "main",
  default_delivery_mode: "remote_review",
  created_at: timestamp,
  updated_at: timestamp,
};

const directory = {
  id: FIXTURE_IDS.directory,
  project_id: FIXTURE_IDS.project,
  name: "repository",
  description: "Primary repository",
  worktree_setup_command: "",
  path: sourcePath,
  role: "primary",
  is_git: true,
  branch: "main",
  head_commit: "0123456789",
  head_summary: "Fixture commit",
  dirty: false,
  created_at: timestamp,
};

const workspace = {
  id: FIXTURE_IDS.workspace,
  project_id: FIXTURE_IDS.project,
  name: FIXTURE_NAMES.workspace,
  description: "Feature development unit",
  status: "active",
  project_directory_id: FIXTURE_IDS.directory,
  checkout_path: workspacePath,
  target_branch: "main",
  start_commit: "0123456789abcdef",
  branch: "treefold/feature-a1b2c3",
  remote_name: "origin",
  remote_branch: "feature/treefold-model",
  branch_ownership: "managed",
  delivery_mode: "remote_review",
  delivery_status: "published",
  runtime_id: FIXTURE_IDS.workspace,
  runtime_name: "treefold-workspace-ui-fixture",
  created_at: timestamp,
  updated_at: timestamp,
};

const shell = {
  id: FIXTURE_IDS.shell,
  workspace_id: FIXTURE_IDS.workspace,
  name: "Workspace Shell",
  kind: "shell",
  cwd: workspacePath,
  original_cwd: workspacePath,
  initial_prompt: "",
  yolo: false,
  sidebar_visible: true,
  status: "running",
};

const projectDetail = {
  ...project,
  directories: [directory],
  workspaces: [workspace],
  worktrees: [{ directory_id: directory.id, directory_name: directory.name, path: sourcePath, branch: "main", head_commit: "0123456789", is_main: true }],
};

const workspaceDetail = {
  ...workspace,
  project,
  directories: [{ ...directory, checkout_path: workspacePath }],
  sessions: [shell],
  todos: [{ id: "todo-ui-fixture", workspace_id: workspace.id, title: "Verify Workspace delivery", description: "", status: "pending" }],
};

const deliveryPreflight = {
  id: "preflight-ui-fixture",
  workspace_id: workspace.id,
  code_action: "remote_merged",
  source_head: "abcdef1234567890",
  target_head: "fedcba0987654321",
  target_branch: "main",
  source_status: "",
  source_dirty: false,
  target_dirty: false,
  ahead: 2,
  behind: 0,
  changed_files: ["src/App.tsx", "src-tauri/src/server.rs"],
  commits: [],
  diff_stat: "2 files changed",
  blockers: [],
  warnings: [],
  created_at: timestamp,
};

export function createSidebarCoreFixture() {
  return structuredClone({
    settings: { schema_version: 1, language: "en-US", worktree_root: "/tmp/treefold-ui-fixture/worktrees", agents: { codex: { extra_args: ["--model", "gpt-5.4"] } } },
    system: { codex_available: true, codex_version: "codex-ui-fixture", backend: "fixture", terminal_runtime: "fixture" },
    projects: [project],
    projectDetails: { [project.id]: projectDetail },
    workspaceDetails: { [workspace.id]: workspaceDetail },
    deliveryPreflights: { [workspace.id]: deliveryPreflight },
  });
}

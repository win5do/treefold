import type { LanguagePreference } from "@/i18n";

export type Project = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  default_location_id?: string;
  default_base_branch: string;
  primary_directory_id: string;
  git_common_dir: string;
  preferred_remote?: string;
  default_target_branch: string;
  default_delivery_mode: "remote_review" | "local_merge";
  updated_at: string;
};

export type Directory = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  worktree_setup_command: string;
  path: string;
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
  delivery_mode?: "remote_review" | "local_merge";
  git_common_dir?: string;
  git_status: "creating" | "ready" | "failed" | "not_git" | "missing" | "broken" | "mismatch";
  checkout_path?: string;
  role: "primary" | "attached";
  is_git: boolean;
  remote_url?: string;
  branch?: string;
  head_commit?: string;
  head_summary?: string;
  dirty: boolean;
};


export type Session = {
  id: string;
  workspace_id: string;
  name: string;
  kind: "shell" | "codex";
  cwd: string;
  original_cwd: string;
  initial_prompt: string;
  codex_session_id?: string;
  sidebar_visible: boolean;
  hidden_at?: string;
  evicted_at?: string;
  process_id: string;
  process_name: string;
  status: string;
  pid?: number;
  process_group_id?: number;
  exit_code?: number;
  exit_signal?: string;
  command?: string[];
  launch_started_at: string;
  last_attached_at?: string;
  created_at: string;
  updated_at: string;
};

export type SessionMenuState = { id: string; x: number; y: number };

export type RenameTarget =
  | { kind: "project"; value: ProjectDetail }
  | { kind: "workspace" | "fork"; value: Workspace }
  | { kind: "session"; value: Session };

export type Workspace = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  kind: "workspace" | "fork";
  parent_workspace_id?: string;
  checkout_mode: "worktree" | "in_place";
  project_directory_id: string;
  checkout_path: string;
  target_branch: string;
  start_commit: string;
  branch: string;
  forked_from_commit?: string;
  remote_name?: string;
  remote_branch?: string;
  branch_ownership: string;
  delivery_mode: "remote_review" | "local_merge";
  delivery_status: string;
  close_outcome?: string;
  integrated_commit?: string;
  closed_at?: string;
  runtime_id: string;
  runtime_name: string;
  updated_at: string;
};

export type WorkspaceLocation = {
  id: string;
  workspace_id: string;
  project_location_id: string;
  location_name: string;
  source_path: string;
  access_mode: "read_write" | "read_only";
  git_status: "creating" | "ready" | "failed" | "not_git" | "missing" | "broken" | "mismatch";
  creation_error?: string;
  checkout_path?: string;
  branch?: string;
  base_branch?: string;
  start_commit?: string;
  remote_name?: string;
  remote_branch?: string;
  delivery_mode: string;
  delivery_status: string;
  close_outcome?: string;
};

export type ProjectDetail = Project & {
  locations: Directory[];
  directories: Directory[];
  sessions: Session[];
  workspaces: Workspace[];
  worktrees: GitWorktree[];
};

export type Todo = { id: string; workspace_id: string; title: string; description: string; status: string };

export type GitWorktree = {
  project_location_id: string;
  location_name: string;
  path: string;
  branch: string;
  head_commit: string;
  is_main: boolean;
  workspace_id?: string;
  workspace_name?: string;
};

export type GitCommit = {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  authored_at: string;
};

export type GitHistory = { branch: string; commits: GitCommit[] };

export type DeliveryPreflight = {
  id: string;
  source_head: string;
  target_head: string;
  target_branch: string;
  source_dirty: boolean;
  target_dirty: boolean;
  ahead: number;
  behind: number;
  changed_files: string[];
  commits: GitCommit[];
  diff_stat: string;
  blockers: string[];
  warnings: string[];
};

export type GitOperationRecord = {
  id: string;
  kind: "delivery" | "rebase" | "reset";
  action: string;
  status: string;
  before_head: string;
  target_head: string;
  result_head?: string;
  recovery_ref?: string;
  error: string;
  started_at: string;
  updated_at: string;
};

export type ProjectLocationInspection = {
  path: string;
  name: string;
  git_status: "ready" | "not_git";
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
};

export type LocationDraft = {
  key: string;
  path: string;
  description: string;
  worktree_setup_command: string;
  base_branch: string;
  delivery_mode: "remote_review" | "local_merge";
  inspection?: ProjectLocationInspection;
  inspectionError?: string;
};

export type WorkspaceDetail = Workspace & {
  project: Project;
  directories: Directory[];
  locations: WorkspaceLocation[];
  sessions: Session[];
  todos: Todo[];
  forks: Workspace[];
};

export type SystemStatus = {
  platform: string;
  codex_available: boolean;
  codex_version?: string;
  backend: string;
  terminal_runtime: string;
};

export type AppSettings = {
  schema_version: number;
  language: LanguagePreference;
  worktree_root: string;
  agents: {
    codex: {
      extra_args: string[];
    };
  };
};


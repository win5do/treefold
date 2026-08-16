import type { LanguagePreference } from "@/i18n";

export type Project = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  default_directory_id?: string;
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
  repository_id?: string;
  repository_name?: string;
  name: string;
  description: string;
  relative_path?: string;
  external_path?: string;
  status?: "ready" | "not_git" | "missing" | "broken" | "mismatch";
  worktree_setup_command: string;
  path: string;
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
  delivery_mode?: "remote_review" | "local_merge";
  git_common_dir?: string;
  git_status:
    | "creating"
    | "ready"
    | "failed"
    | "not_git"
    | "missing"
    | "broken"
    | "mismatch";
  last_checked_at?: string;
  checkout_path?: string;
  role: "primary" | "attached";
  is_git: boolean;
  remote_url?: string;
  branch?: string;
  head_commit?: string;
  head_summary?: string;
  dirty: boolean;
};

export type ProjectRepository = {
  id: string;
  project_id: string;
  name: string;
  source_root: string;
  git_common_dir: string;
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch: string;
  delivery_mode: "remote_review" | "local_merge";
  setup_command: string;
  setup_workdir: string;
  git_status: Directory["git_status"];
  last_checked_at?: string;
  created_at: string;
  updated_at: string;
};

export type Session = {
  id: string;
  workspace_id: string;
  name: string;
  kind: "shell" | "codex" | "command";
  cwd: string;
  original_cwd: string;
  initial_prompt: string;
  codex_session_id?: string;
  visibility: "visible" | "hidden";
  hidden_at?: string;
  evicted_at?: string;
  amux_workspace_name: string;
  amux_process_name: string;
  status: "running" | "stopped" | "exited" | "failed";
  exit_code?: number;
  exit_signal?: string;
  argv: string[];
  io_mode: "pipe" | "tty";
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
  git_status:
    | "creating"
    | "ready"
    | "failed"
    | "not_git"
    | "missing"
    | "broken"
    | "mismatch";
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

export type WorkspaceRepository = WorkspaceLocation;

export type WorkspaceDirectory = {
  id: string;
  workspace_id: string;
  project_directory_id: string;
  workspace_repository_id?: string;
  name: string;
  description: string;
  relative_path?: string;
  external_path?: string;
  path: string;
  access_mode: "read_write" | "read_only";
  status: "ready" | "not_git" | "missing" | "broken" | "mismatch";
  created_at: string;
  updated_at: string;
};

export type ProjectDetail = Project & {
  repositories: ProjectRepository[];
  locations: Directory[];
  directories: Directory[];
  sessions: Session[];
  workspaces: Workspace[];
  worktrees: GitWorktree[];
};

export type ProjectSummary = Pick<
  Project,
  "id" | "name" | "description" | "status" | "updated_at"
> & {
  location_count: number;
  git_location_count: number;
  context_location_count: number;
  missing_location_count: number;
  abnormal_location_count: number;
  active_workspace_count: number;
};

export type SidebarWorkspace = Workspace & {
  sessions: Session[];
  repositories: WorkspaceRepository[];
  directories: WorkspaceDirectory[];
  locations?: WorkspaceLocation[];
};
export type SidebarProject = Project & {
  repositories: ProjectRepository[];
  directories: Directory[];
  locations?: Directory[];
  sessions: Session[];
  workspaces: SidebarWorkspace[];
};
export type SidebarData = { projects: SidebarProject[] };

export type Todo = {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  status: string;
};

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

export type GitDiffComparison = {
  repository: string;
  resolved_base: string;
  resolved_head: string;
  commit_count: number;
  patch: string;
};

export type GitDiffLaunchPayload = {
  repositoryKind: "project" | "workspace";
  repositoryId: string;
  repositoryName: string;
  startCommit: string;
  endCommit: string;
  commitCount: number;
};

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

export type ProjectLocationInspection = {
  path: string;
  name: string;
  directory_type: "git_scope" | "external";
  git_status: "ready" | "not_git";
  source_root?: string;
  git_common_dir?: string;
  relative_path?: string;
  repository_id?: string;
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
  repositories: WorkspaceRepository[];
  locations: WorkspaceLocation[];
  workspace_directories: WorkspaceDirectory[];
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

export type ThemePreference = "system" | "light" | "dark";

export type AppSettings = {
  schema_version: number;
  language: LanguagePreference;
  theme: ThemePreference;
  worktree_root: string;
  agents: {
    codex: {
      extra_args: string[];
    };
  };
  amux: {
    keep_daemon_running_on_exit: boolean;
  };
};

export type AmuxStatus = {
  name: string;
  running: boolean;
  started_at?: string;
  active_groups: number;
  active_processes: number;
};

export type BackgroundProcess = {
  id: string;
  workspace_id: string;
  group_id: string;
  parent_process_id?: string;
  session_id?: string;
  session_root: boolean;
  name: string;
  command: string[];
  cwd: string;
  state:
    | "created"
    | "starting"
    | "running"
    | "stopping"
    | "exited"
    | "failed"
    | "unknown";
  pid: number;
  execution: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
};
